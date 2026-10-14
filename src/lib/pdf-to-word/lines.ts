/** Text items to lines. Pure geometry, no DOM: coordinates are points with the origin top-left. */

export type TextItem = {
  str: string;
  x: number;
  /** Baseline, measured down from the top of the page. */
  y: number;
  w: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  generic?: "serif" | "sans" | "mono";
  color?: string;
};

export type Rule = { x0: number; y0: number; x1: number; y1: number };

/** A painted block of colour, in points from the top left; colour is hex without a hash. */
export type Fill = { x0: number; y0: number; x1: number; y1: number; color: string };

/** A list bullet the page draws as a shape instead of a character, in points from the top left. */
export type Bullet = { x0: number; x1: number; y0: number; y1: number; kind: "disc" | "circle" | "square" };

export type PageImage = { ref: string; x: number; y: number; w: number; h: number };

/** A clickable area of the page, in points from the top left. An anchor names a spot in the document. */
export type PageLink = {
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  url?: string;
  anchor?: Anchor;
};

/** A place in the document: the page (counting from 0) and how far down it is. */
export type Anchor = { name: string; page: number; y: number };

export type PageInput = {
  width: number;
  height: number;
  items: TextItem[];
  rules: Rule[];
  images: PageImage[];
  links?: PageLink[];
  fills?: Fill[];
  bullets?: Bullet[];
};

export type Frag = {
  text: string;
  x0: number;
  x1: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
  generic?: "serif" | "sans" | "mono";
  color?: string;
  /** True on the first piece after a wide gap in the same row. */
  tabBefore?: boolean;
  link?: { url: string } | { anchor: string };
};

export type Line = {
  frags: Frag[];
  x0: number;
  x1: number;
  baseline: number;
  size: number;
  top: number;
  bottom: number;
  /** Lines cut from one row of the page share this. */
  row: number;
  /** The column the line lives in. */
  colL: number;
  colR: number;
};

export type Marker = {
  kind: "bullet" | "decimal" | "lowerLetter" | "upperLetter";
  suffix: string;
  start: number;
  /** Characters of the line text the marker (and the space after it) covers. */
  length: number;
  /** The character a bullet is shown with. */
  glyph?: string;
};

const BULLET_GLYPHS = "•●○◦▪■▫‣⁃□∙";
const BULLET_PUA = /^[]/;
const DASH_GLYPHS = "-–—*·";

/** Bullet characters Word can show as they are; anything else (private-use symbols) becomes a plain dot. */
function bulletGlyph(ch: string): string {
  if ("•◦▪‣-–*○■".includes(ch)) return ch;
  if ("●∙·".includes(ch)) return "•";
  if ("▫□".includes(ch)) return "▪";
  return "•";
}

export function matchMarker(text: string): Marker | null {
  const trimmed = text.replace(/^\s+/, "");
  const lead = text.length - trimmed.length;
  if (!trimmed) return null;
  const first = trimmed[0];
  if (BULLET_GLYPHS.includes(first) || BULLET_PUA.test(trimmed)) {
    const space = /^\s*/.exec(trimmed.slice(1))?.[0].length ?? 0;
    return { kind: "bullet", suffix: "", start: 1, length: lead + 1 + space, glyph: bulletGlyph(first) };
  }
  if (DASH_GLYPHS.includes(first) && (trimmed.length === 1 || /^\s/.test(trimmed.slice(1)))) {
    const space = /^\s*/.exec(trimmed.slice(1))?.[0].length ?? 0;
    return { kind: "bullet", suffix: "", start: 1, length: lead + 1 + space, glyph: bulletGlyph(first) };
  }
  const digits = /^(\d{1,3})([.)])(\s+|$)/.exec(trimmed);
  if (digits) {
    return {
      kind: "decimal",
      suffix: digits[2],
      start: Number(digits[1]),
      length: lead + digits[0].length,
    };
  }
  const lower = /^([a-z])\)(\s+|$)/.exec(trimmed);
  if (lower) {
    return {
      kind: "lowerLetter",
      suffix: ")",
      start: lower[1].charCodeAt(0) - 96,
      length: lead + lower[0].length,
    };
  }
  const upper = /^([A-Z])\)(\s+|$)/.exec(trimmed);
  if (upper) {
    return {
      kind: "upperLetter",
      suffix: ")",
      start: upper[1].charCodeAt(0) - 64,
      length: lead + upper[0].length,
    };
  }
  return null;
}

export function lineText(line: Pick<Line, "frags">): string {
  return line.frags.map((f) => f.text).join("");
}

export function makeLine(frags: Frag[], row: number): Line {
  const x0 = Math.min(...frags.map((f) => f.x0));
  const x1 = Math.max(...frags.map((f) => f.x1));
  // The size that most characters are set in; the baseline comes from it too.
  const weight = new Map<number, number>();
  for (const f of frags) {
    const key = Math.round(f.size * 2) / 2;
    weight.set(key, (weight.get(key) ?? 0) + f.text.trim().length + 0.1);
  }
  let size = frags[0].size;
  let best = -1;
  for (const [s, w] of weight) {
    if (w > best) {
      best = w;
      size = s;
    }
  }
  return {
    frags,
    x0,
    x1,
    baseline: 0,
    size,
    top: 0,
    bottom: 0,
    row,
    colL: x0,
    colR: x1,
  };
}

function setBaseline(line: Line, baseline: number): Line {
  line.baseline = baseline;
  line.top = baseline - line.size * 0.8;
  line.bottom = baseline + line.size * 0.22;
  return line;
}

type Row = { baseline: number; size: number; items: TextItem[] };

/** Cut a row's items (already sorted by x) into pieces wherever a wide gap opens. */
function segments(items: TextItem[]): Frag[][] {
  const out: Frag[][] = [];
  let current: Frag[] = [];
  for (const item of items) {
    const frag: Frag = {
      text: item.str,
      x0: item.x,
      x1: item.x + item.w,
      size: item.size,
      font: item.font,
      bold: item.bold,
      italic: item.italic,
      generic: item.generic,
      color: item.color,
    };
    const prev = current[current.length - 1];
    if (prev) {
      const gap = frag.x0 - prev.x1;
      const size = Math.max(prev.size, frag.size);
      const markerGap =
        current.length === 1 && matchMarker(prev.text) !== null && gap < size * 6;
      if (gap > Math.max(8, size * 1.4) && !markerGap) {
        out.push(current);
        current = [];
      } else if (
        gap > size * 0.12 &&
        !/\s$/.test(prev.text) &&
        !/^\s/.test(frag.text)
      ) {
        prev.text += " ";
      }
    }
    current.push(frag);
  }
  if (current.length) out.push(current);
  return out;
}

export function buildLines(items: TextItem[]): Line[] {
  const clean = items
    .filter((i) => i.str.trim().length > 0 && Number.isFinite(i.x) && Number.isFinite(i.y))
    .map((i) => ({ ...i, size: i.size > 0 ? i.size : 10 }))
    .sort((a, b) => a.y - b.y || a.x - b.x);
  // Text drawn twice a hair apart to fake bold shows up as duplicates.
  const unique: TextItem[] = [];
  for (const item of clean) {
    const dup = unique.some(
      (u) =>
        u.str === item.str &&
        Math.abs(u.x - item.x) < 1.5 &&
        Math.abs(u.y - item.y) < 1.5,
    );
    if (!dup) unique.push(item);
  }
  const rows: Row[] = [];
  for (const item of unique) {
    let found: Row | undefined;
    for (let i = rows.length - 1; i >= 0 && i >= rows.length - 8; i--) {
      const row = rows[i];
      if (Math.abs(row.baseline - item.y) <= 0.42 * Math.max(row.size, item.size)) {
        found = row;
        break;
      }
    }
    if (found) {
      found.items.push(item);
      if (item.size > found.size) {
        found.size = item.size;
        found.baseline = item.y;
      }
    } else {
      rows.push({ baseline: item.y, size: item.size, items: [item] });
    }
  }
  const lines: Line[] = [];
  rows.forEach((row, index) => {
    const sorted = row.items.sort((a, b) => a.x - b.x);
    for (const frags of segments(sorted)) {
      const line = makeLine(frags, index);
      setBaseline(line, row.baseline);
      lines.push(line);
    }
  });
  return lines;
}

/** A new line from some of the pieces of others, keeping the row it came from. */
export function lineFromFrags(frags: Frag[], row: number, baseline: number): Line {
  return setBaseline(makeLine(frags, row), baseline);
}
