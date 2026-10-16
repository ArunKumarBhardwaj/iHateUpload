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
  /** The Word family to name when the font travels with the document. */
  wordFont?: string;
  color?: string;
};

export type Rule = { x0: number; y0: number; x1: number; y1: number };

/** A painted block of colour, in points from the top left; colour is hex without a hash. */
export type Fill = { x0: number; y0: number; x1: number; y1: number; color: string };

/** A list bullet the page draws as a shape instead of a character, in points from the top left. */
export type Bullet = { x0: number; x1: number; y0: number; y1: number; kind: "disc" | "circle" | "square" };

/** One step of a drawn path, in points from the top left of the page. C holds two control points and an end. */
export type PathSeg = { op: "M" | "L" | "C" | "Z"; pts: number[] };

/** A painted path as the page draws it: its outline and how it is filled and stroked. */
export type PathShape = {
  segs: PathSeg[];
  /** Hex without a hash; omitted when the path is not filled. */
  fill?: string;
  stroke?: string;
  /** Stroke width in points. */
  width: number;
  fillAlpha?: number;
  strokeAlpha?: number;
  dash?: boolean;
  /** Nothing the page prints lies under this path, so it can sit behind the text. */
  behind: boolean;
};

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
  shapes?: PathShape[];
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
  wordFont?: string;
  color?: string;
  /** Baseline of this piece, measured down from the top of the page. */
  y?: number;
  underline?: boolean;
  strike?: boolean;
  /** Hex of a box painted behind the text. */
  highlight?: string;
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

export type MarkerKind = "bullet" | "decimal" | "lowerLetter" | "upperLetter" | "lowerRoman" | "upperRoman";

export type Marker = {
  kind: MarkerKind;
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

const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 };
const ROMAN = /^(?=[ivxlc])(c{0,1})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

function romanValue(token: string): number | null {
  const lower = token.toLowerCase();
  if (!ROMAN.test(lower)) return null;
  let total = 0;
  for (let i = 0; i < lower.length; i++) {
    const v = ROMAN_VALUES[lower[i]];
    const next = ROMAN_VALUES[lower[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/**
 * Every way the start of a line can be read as a list marker. Bullets, numbers and "a)" are
 * certain; "a.", "i." and "IV." could be a word or an initial, so they are flagged and need a
 * neighbour that counts on from them.
 */
export function markerCandidates(text: string): { marker: Marker; ambiguous: boolean }[] {
  const certain = matchMarker(text);
  if (certain) return [{ marker: certain, ambiguous: false }];
  const trimmed = text.replace(/^\s+/, "");
  const lead = text.length - trimmed.length;
  const m = /^([A-Za-z]{1,5})([.)])(\s+\S|\s*$)/.exec(trimmed);
  if (!m) return [];
  const [whole, token, suffix] = m;
  const length = lead + token.length + 1 + (/^\s*/.exec(whole.slice(token.length + 1))?.[0].length ?? 0);
  const out: { marker: Marker; ambiguous: boolean }[] = [];
  const roman = romanValue(token);
  const upper = token === token.toUpperCase();
  if (token.length === 1 && suffix === ".") {
    const code = token.toLowerCase().charCodeAt(0) - 96;
    out.push({
      marker: { kind: upper ? "upperLetter" : "lowerLetter", suffix, start: code, length },
      ambiguous: true,
    });
  }
  if (roman !== null && (token === token.toLowerCase() || upper)) {
    out.push({
      marker: { kind: upper ? "upperRoman" : "lowerRoman", suffix, start: roman, length },
      ambiguous: true,
    });
  }
  return out;
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

const sizeKey = (size: number) => Math.round(size * 2) / 2;

/** The usual gap between neighbouring words at each size in a row, from the row's own items. */
function wordGaps(items: TextItem[]): Map<number, number> {
  const bySize = new Map<number, number[]>();
  for (let i = 1; i < items.length; i++) {
    const a = items[i - 1];
    const b = items[i];
    const gap = b.x - (a.x + a.w);
    if (gap <= 0 || Math.abs(a.size - b.size) > 0.5) continue;
    const key = sizeKey(a.size);
    (bySize.get(key) ?? bySize.set(key, []).get(key)!).push(gap);
  }
  const out = new Map<number, number>();
  for (const [key, gaps] of bySize) {
    gaps.sort((x, y) => x - y);
    out.set(key, gaps[Math.floor(gaps.length / 2)]);
  }
  return out;
}

/**
 * Cut a row's items (already sorted by x) into pieces wherever a wide gap opens: a gap well past
 * the row's own word spacing is a gutter or a left/right pair, not a stretched space. A justified
 * line spreads its gaps evenly, so its median stays close to every gap and it is left whole.
 */
function segments(items: TextItem[]): Frag[][] {
  const spaces = wordGaps(items);
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
      wordFont: item.wordFont,
      color: item.color,
      y: item.y,
    };
    const prev = current[current.length - 1];
    if (prev) {
      const gap = frag.x0 - prev.x1;
      const size = Math.max(prev.size, frag.size);
      const markerGap =
        current.length === 1 && markerCandidates(prev.text).length > 0 && gap < size * 6;
      const small = Math.min(prev.size, frag.size);
      const sameSize = Math.abs(prev.size - frag.size) <= 0.2 * small;
      const space = sameSize ? (spaces.get(sizeKey(small)) ?? 0.3 * small) : 0;
      const outlier = gap > Math.max(2.5 * space, 1.2 * small);
      if ((gap > Math.max(8, size * 1.4) || outlier) && !markerGap) {
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
      // Pieces side by side may sit a few points off one another (a pull quote beside body text),
      // so each keeps the baseline of its own largest text rather than the row's.
      const biggest = frags.reduce((a, f) => (f.size > a.size ? f : a), frags[0]);
      setBaseline(line, biggest.y ?? row.baseline);
      lines.push(line);
    }
  });
  return lines;
}

/** A new line from some of the pieces of others, keeping the row it came from. */
export function lineFromFrags(frags: Frag[], row: number, baseline: number): Line {
  return setBaseline(makeLine(frags, row), baseline);
}
