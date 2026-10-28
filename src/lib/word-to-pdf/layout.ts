/**
 * Flow layout: blocks in, positioned drawing commands out. Pure and font-agnostic: the caller
 * supplies a text measurer, so the same code runs against pdf-lib fonts and in unit tests.
 * Coordinates in the output are top-down from the page's top-left corner, in points.
 */
import type { Align, Block, Cell, Edge, Family, Inline, InlineStyle, LineSpec, Para, TableBlock } from "./model";
import { visualOrder } from "./bidi";
import type { PageSpec } from "./page";

export interface FontKey {
  family: Family;
  bold: boolean;
  italic: boolean;
}
export type Measurer = (text: string, key: FontKey, size: number) => number;

export type Cmd =
  | {
      t: "text";
      x: number;
      /** baseline */
      y: number;
      text: string;
      size: number;
      family: Family;
      bold: boolean;
      italic: boolean;
      color?: string;
      underline: boolean;
      strike: boolean;
      /** degrees anticlockwise about (x, y) */
      rotate?: number;
    }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width: number; color: string; dash?: number[] }
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number }
  /** an SVG path in page coordinates (top-down), used by the slide renderer */
  | { t: "shape"; x: number; y: number; path: string; fill?: string; stroke?: string; strokeWidth?: number }
  /** invisible marker for a heading, so a table of contents can find its page */
  | { t: "anchor"; x: number; y: number; id: number }
  | {
      t: "image";
      x: number;
      y: number;
      w: number;
      h: number;
      data: Uint8Array;
      mime: string;
      color?: string;
      /** only the part inside this rectangle (same coordinates) is drawn */
      clip?: { x: number; y: number; w: number; h: number };
      /** drawn after everything else on the page (pictures over spreadsheet cells) */
      above?: boolean;
    }
  | { t: "link"; x: number; y: number; w: number; h: number; href: string };

export interface LaidOutPage {
  cmds: Cmd[];
}

export const BASE_SIZE = 11;
const HEADING_SIZE: Record<number, number> = { 1: 20, 2: 16, 3: 14, 4: 12.5, 5: 11.5, 6: 11 };
const TITLE_SIZE = 26;
const LINK_COLOR = "0563C1";
const BORDER_COLOR = "7F7F7F";
const HEADER_FILL = "EDEDED";
const CELL_PAD_X = 5;
/** a one-line paragraph is shrunk to at most this fraction of its size before it is cut instead */
const ONE_LINE_MIN_SCALE = 0.8;
/** how much wider than its cell a spreadsheet number may measure before it shows as ### */
const NUMBER_SLACK = 1.06;
const CELL_PAD_Y = 3;
const LIST_BASE = 24;
const LIST_STEP = 24;
const BOX_PAD = 6;

interface Item {
  h: number;
  before: number;
  after: number;
  /** relative to the item's top-left; x is relative to the flow origin */
  cmds: Cmd[];
  keepNext?: boolean;
  /** this much more must fit on the page with the item (rows a merged cell spans) */
  keepWith?: number;
  forceBreak?: boolean;
  table?: { id: number; headers: Item[] };
  isHeader?: boolean;
  /** start a new page with this item (a manual page break) */
  breakBefore?: boolean;
}

interface Ctx {
  measure: Measurer;
  compact: boolean;
  bold: boolean;
  maxImgH: number;
  nextTable: { n: number };
  lineFactor: (key: FontKey) => number;
}

interface Resolved {
  size: number;
  rise: number;
  key: FontKey;
  color?: string;
  underline: boolean;
  strike: boolean;
  href?: string;
}

type Atom =
  | { k: "w"; text: string; w: number; r: Resolved }
  | { k: "s"; w: number; r: Resolved; /** more than one space, kept (spreadsheet cells) */ text?: string }
  | { k: "i"; w: number; h: number; data: Uint8Array; mime: string; href?: string; depth?: number; color?: string }
  | { k: "br" };

const clean = (s: string) => s.replace(/ /g, " ").replace(/[​­\r\n\t]/g, "");

function baseSizeOf(p: Para): number {
  if (p.docxStyled && p.base?.size) return p.base.size;
  if (p.title) return TITLE_SIZE;
  if (p.heading > 0) return HEADING_SIZE[p.heading] ?? BASE_SIZE;
  return BASE_SIZE;
}

function resolve(style: InlineStyle, p: Para, ctx: Ctx): Resolved {
  const base = style.size ?? baseSizeOf(p);
  const db = p.docxStyled ? p.base : undefined;
  const sc = style.script;
  const isLink = !!style.href;
  return {
    size: sc ? base * 0.65 : base,
    rise: sc === "sup" ? base * 0.35 : sc === "sub" ? -base * 0.15 : 0,
    key: {
      family: style.family ?? db?.family ?? "sans",
      bold: style.bold || (p.docxStyled ? !!db?.bold : p.heading > 0) || ctx.bold,
      italic: style.italic || !!db?.italic,
    },
    color: style.color ?? db?.color ?? (isLink ? LINK_COLOR : undefined),
    underline: style.underline || isLink,
    strike: style.strike,
    href: style.href,
  };
}

function atomise(p: Para, ctx: Ctx, avail: number): Atom[] {
  const atoms: Atom[] = [];
  for (const inl of p.inlines as Inline[]) {
    if (inl.kind === "br") {
      atoms.push({ k: "br" });
    } else if (inl.kind === "image") {
      let w = inl.width || 100;
      let h = inl.height || 100;
      const s = Math.min(1, avail / w, ctx.maxImgH / h);
      w *= s;
      h *= s;
      atoms.push({ k: "i", w, h, data: inl.data, mime: inl.mime, depth: inl.depth ? inl.depth * s : undefined, color: inl.color });
    } else {
      const r = resolve(inl.style, p, ctx);
      if (p.pre) {
        // code: keep every space, one unbreakable word per line (long lines split by character)
        const text = inl.text.replace(/\t/g, "    ").replace(/\r/g, "");
        if (text) atoms.push({ k: "w", text, w: ctx.measure(text, r.key, r.size), r });
        continue;
      }
      for (const tok of inl.text.split(/([ \t\r\n]+)/)) {
        if (!tok) continue;
        if (/^[ \t\r\n]+$/.test(tok)) {
          // a spreadsheet cell keeps runs of spaces, which people use to push text along
          const n = p.oneLine ? tok.replace(/[\r\n]/g, "").length || 1 : 1;
          atoms.push(n > 1 ? { k: "s", w: ctx.measure(" ", r.key, r.size) * n, r, text: " ".repeat(n) } : { k: "s", w: ctx.measure(" ", r.key, r.size), r });
        } else {
          const text = clean(tok);
          if (text) atoms.push({ k: "w", text, w: ctx.measure(text, r.key, r.size), r });
        }
      }
    }
  }
  return atoms;
}

/**
 * A spreadsheet cell's one line, for the cases where Excel changes the text rather than clipping it:
 * numbers too wide for the column, and "fill" alignment.
 */
function fitSpreadsheetText(p: Para, avail: number, ctx: Ctx): Para {
  const first = p.inlines.find((i) => i.kind === "text");
  if (!first || first.kind !== "text" || p.inlines.length !== 1) return p;
  const r = resolve(first.style, p, ctx);
  const width = (t: string) => ctx.measure(t, r.key, r.size);
  const set = (text: string): Para => ({ ...p, inlines: [{ ...first, text }] });
  const text = first.text;
  if (p.repeat) {
    const w = width(text);
    return w > 0 && w <= avail ? set(text.repeat(Math.floor(avail / w))) : p;
  }
  // the bundled fonts stand in for Office's and can run a few percent wider: a number that only
  // just overflows is set a touch smaller (below) rather than shown as ###
  if (width(text) <= avail * NUMBER_SLACK + 0.01) return p;
  if (p.fit === "round") {
    const v = Number(text);
    if (Number.isFinite(v)) {
      const decimals = (text.split(".")[1] ?? "").length;
      for (let d = decimals - 1; d >= 0; d--) {
        const t = String(Number(v.toFixed(d)));
        // a small number rounded away to 0 goes scientific instead
        if (Number(t) === 0 && v !== 0) break;
        if (width(t) <= avail) return set(t);
      }
      for (let d = 5; d >= 0; d--) {
        const t = v.toExponential(d).toUpperCase().replace(/E([+-])(\d)$/, "E$10$2");
        if (width(t) <= avail) return set(t);
      }
    }
  }
  const hash = width("#");
  return set("#".repeat(Math.max(1, Math.floor(avail / (hash || 1)))));
}

const graphemes = (t: string): string[] => {
  const Seg = (Intl as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(t), (g) => g.segment) : Array.from(t);
};

/** The longest start of a word that fits in `room`, or null. */
function fitPrefix(a: Extract<Atom, { k: "w" }>, room: number, ctx: Ctx): Extract<Atom, { k: "w" }> | null {
  const gs = graphemes(a.text);
  let lo = 0;
  let hi = gs.length;
  // binary search on the number of graphemes
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measure(gs.slice(0, mid).join(""), a.r.key, a.r.size) <= room + 0.01) lo = mid;
    else hi = mid - 1;
  }
  if (!lo) return null;
  const text = gs.slice(0, lo).join("");
  return { k: "w", text, w: ctx.measure(text, a.r.key, a.r.size), r: a.r };
}

/** Break a too-wide word into chunks that each fit. */
function splitWord(a: Extract<Atom, { k: "w" }>, avail: number, ctx: Ctx): Atom[] {
  const out: Atom[] = [];
  let rest = Array.from(a.text);
  while (rest.length) {
    let n = rest.length;
    let w = ctx.measure(rest.join(""), a.r.key, a.r.size);
    while (n > 1 && w > avail) {
      n--;
      w = ctx.measure(rest.slice(0, n).join(""), a.r.key, a.r.size);
    }
    out.push({ k: "w", text: rest.slice(0, n).join(""), w, r: a.r });
    rest = rest.slice(n);
  }
  return out;
}

interface Line {
  atoms: Atom[];
  width: number;
  hardBreak: boolean;
}

function breakLines(atoms: Atom[], avail: number, ctx: Ctx): Line[] {
  const lines: Line[] = [];
  let cur: Atom[] = [];
  let width = 0;
  const finish = (hard: boolean) => {
    while (cur.length && cur[cur.length - 1].k === "s") {
      width -= (cur.pop() as Atom & { w: number }).w;
    }
    lines.push({ atoms: cur, width: Math.max(0, width), hardBreak: hard });
    cur = [];
    width = 0;
  };
  const queue = [...atoms];
  while (queue.length) {
    const a = queue.shift() as Atom;
    if (a.k === "br") {
      finish(true);
    } else if (a.k === "s") {
      if (cur.length) {
        cur.push(a);
        width += a.w;
      }
    } else if (a.k === "i") {
      if (width + a.w > avail + 0.01 && cur.length) finish(false);
      cur.push(a);
      width += a.w;
    } else {
      if (width + a.w > avail + 0.01) {
        if (cur.length) finish(false);
        if (a.w > avail + 0.01) {
          const parts = splitWord(a, avail, ctx);
          if (parts.length > 1) {
            queue.unshift(...parts);
            continue;
          }
        }
      }
      cur.push(a);
      width += a.w;
    }
  }
  if (cur.length || !lines.length) finish(false);
  return lines.filter((l, i) => l.atoms.length || i < lines.length - 1 || lines.length === 1);
}

function sameRun(a: Resolved, b: Resolved): boolean {
  return (
    a.size === b.size &&
    a.rise === b.rise &&
    a.key.family === b.key.family &&
    a.key.bold === b.key.bold &&
    a.key.italic === b.key.italic &&
    a.color === b.color &&
    a.underline === b.underline &&
    a.strike === b.strike &&
    a.href === b.href
  );
}

function lineItem(
  line: Line,
  x0: number,
  avail: number,
  align: Align,
  last: boolean,
  fallbackSize: number,
  ctx: Ctx,
  spec: LineSpec | undefined,
): Item {
  const atoms = line.atoms;
  let maxSize = 0;
  let natural = 0;
  let imgH = 0;
  let imgDepth = 0;
  for (const a of atoms) {
    if (a.k === "i") {
      imgH = Math.max(imgH, a.h - (a.depth ?? 0));
      imgDepth = Math.max(imgDepth, a.depth ?? 0);
    } else if (a.k === "w" || a.k === "s") {
      maxSize = Math.max(maxSize, a.r.size);
      natural = Math.max(natural, a.r.size * ctx.lineFactor(a.r.key));
    }
  }
  if (!maxSize) maxSize = fallbackSize;
  if (!natural) natural = maxSize * 1.22;
  const descent = Math.max(maxSize * 0.25, imgDepth);
  let textH = natural;
  if (spec?.kind === "mult") textH = natural * spec.v;
  else if (spec?.kind === "exact") textH = spec.v;
  else if (spec?.kind === "atLeast") textH = Math.max(natural, spec.v);
  const lineH = Math.max(textH, imgH ? imgH + descent + maxSize * 0.05 : 0);
  const baseline = lineH - descent - maxSize * 0.05;

  const justify = align === "justify" && !last && !line.hardBreak;
  const gaps = atoms.filter((a) => a.k === "s").length;
  const extra = justify && gaps ? Math.max(0, avail - line.width) / gaps : 0;
  let x = x0;
  if (align === "center") x += (avail - line.width) / 2;
  else if (align === "right") x += avail - line.width;

  const cmds: Cmd[] = [];
  let run: { text: string; x: number; w: number; r: Resolved } | null = null;
  const flush = () => {
    if (!run) return;
    const r = run.r;
    const text = run.text.replace(/\s+$/, "");
    if (text) {
      cmds.push({
        t: "text",
        x: run.x,
        y: baseline - r.rise,
        text,
        size: r.size,
        family: r.key.family,
        bold: r.key.bold,
        italic: r.key.italic,
        color: r.color,
        underline: r.underline,
        strike: r.strike,
      });
      if (r.href) {
        cmds.push({ t: "link", x: run.x, y: baseline - r.size * 0.95 - r.rise, w: run.w, h: r.size * 1.2, href: r.href });
      }
    }
    run = null;
  };
  for (const a of atoms) {
    if (a.k === "i") {
      flush();
      cmds.push({ t: "image", x, y: baseline - a.h + (a.depth ?? 0), w: a.w, h: a.h, data: a.data, mime: a.mime, color: a.color });
      x += a.w;
    } else if (a.k === "w" || a.k === "s") {
      const w = a.w + (a.k === "s" ? extra : 0);
      if (justify) {
        if (a.k === "w") {
          flush();
          run = { text: a.text, x, w: a.w, r: a.r };
          flush();
        }
      } else if (run && sameRun(run.r, a.r)) {
        run.text += a.k === "w" ? a.text : (a.text ?? " ");
        run.w += w;
      } else {
        flush();
        run = { text: a.k === "w" ? a.text : (a.text ?? " "), x, w, r: a.r };
      }
      x += w;
    }
  }
  flush();
  return { h: lineH, before: 0, after: 0, cmds: reorderRtlLine(cmds, ctx) };
}

const RTL_LETTER = /[\u0590-\u05FF\u0600-\u065F\u066E-\u06EF\u06FA-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;

/**
 * A line drawn as several text commands (justified, or with bold and plain words) that holds
 * right-to-left text: put the commands in visual order. Each keeps its width; the gaps between them
 * keep their sizes, in order from the left.
 */
function reorderRtlLine(cmds: Cmd[], ctx: Ctx): Cmd[] {
  const texts = cmds.filter((c): c is Extract<Cmd, { t: "text" }> => c.t === "text");
  if (texts.length < 2 || !texts.some((c) => RTL_LETTER.test(c.text))) return cmds;
  const width = (c: Extract<Cmd, { t: "text" }>) => ctx.measure(c.text, { family: c.family, bold: c.bold, italic: c.italic }, c.size);
  const byX = [...texts].sort((a, b) => a.x - b.x);
  const gaps = byX.slice(1).map((c, i) => c.x - (byX[i].x + width(byX[i])));
  const order = visualOrder(byX, (c) => RTL_LETTER.test(c.text));
  let x = byX[0].x;
  const placed = order.map((c, i) => {
    const out = { ...c, x };
    x += width(c) + (gaps[i] ?? 0);
    return out;
  });
  return [...cmds.filter((c) => c.t !== "text"), ...placed];
}

function paraItems(p: Para, width: number, ctx: Ctx): Item[] {
  if (p.rule) {
    return [
      {
        h: 1,
        before: ctx.compact ? 2 : 8,
        after: ctx.compact ? 2 : 8,
        cmds: [{ t: "line", x1: 0, y1: 0.5, x2: width, y2: 0.5, width: 1, color: "BFBFBF" }],
      },
    ];
  }
  const level = p.marker?.level ?? 0;
  const textX = p.marker ? (p.marker.base ?? LIST_BASE) + (p.marker.step ?? LIST_STEP) * level : p.indent;
  const avail = Math.max(20, width - textX - (p.box ? BOX_PAD : 0));
  if (p.oneLine && (p.fit === "hash" || p.fit === "round" || p.repeat)) p = fitSpreadsheetText(p, avail, ctx);
  let atoms = atomise(p, ctx, avail);
  let lines = breakLines(atoms, avail * (1 + (p.slack ?? 0)), ctx);
  const size = baseSizeOf(p);
  if (p.oneLine && lines.length > 1 && !atoms.some((a) => a.k === "br")) {
    const natural = breakLines(atoms, Number.POSITIVE_INFINITY, ctx)[0]?.width ?? 0;
    const f = natural > 0 ? avail / natural : 1;
    if (f < 1 && (f >= ONE_LINE_MIN_SCALE || p.fit === "shrink")) {
      const smaller: Para = {
        ...p,
        inlines: p.inlines.map((i) => (i.kind === "text" ? { ...i, style: { ...i.style, size: (i.style.size ?? size) * f * 0.995 } } : i)),
      };
      atoms = atomise(smaller, ctx, avail);
      lines = breakLines(atoms, avail, ctx);
    }
    if (lines.length > 1) {
      // cut at the edge, as a spreadsheet clips a cell: whole words, then as much of the next word
      // as fits, by whole characters (graphemes, so a Devanagari syllable is never split)
      const kept: Atom[] = [];
      let w = 0;
      for (const a of atoms) {
        if (a.k === "br") break;
        const aw = (a as { w: number }).w;
        if (a.k === "w" && w + aw > avail) {
          const part = fitPrefix(a, avail - w, ctx);
          if (part) {
            kept.push(part);
            w += part.w;
          }
          break;
        }
        if (a.k === "i" && w + aw > avail) break;
        kept.push(a);
        w += aw;
      }
      while (kept.length && kept[kept.length - 1].k === "s") w -= (kept.pop() as { w: number }).w;
      lines = [{ atoms: kept, width: Math.max(0, w), hardBreak: false }];
    }
  }
  const items = lines.map((l, i) => lineItem(l, textX, avail, p.align, i === lines.length - 1, size, ctx, p.spacing?.line));

  if (p.marker?.label && items.length) {
    const first = atoms.find((a) => a.k === "w") as Extract<Atom, { k: "w" }> | undefined;
    const r = first?.r ?? resolve({ bold: false, italic: false, underline: false, strike: false }, p, ctx);
    const key: FontKey = { family: r.key.family, bold: false, italic: false };
    const w = ctx.measure(p.marker.label, key, r.size);
    const firstText = items[0].cmds.find((c) => c.t === "text") as Extract<Cmd, { t: "text" }> | undefined;
    const y = firstText ? firstText.y + r.rise : items[0].h * 0.75;
    items[0].cmds.unshift({
      t: "text",
      x: textX - 6 - w,
      y,
      text: p.marker.label,
      size: r.size,
      family: key.family,
      bold: false,
      italic: false,
      color: r.color && r.href ? undefined : r.color,
      underline: false,
      strike: false,
    });
  }

  if (!ctx.compact && items.length) {
    const h = p.heading;
    items[0].before = p.spacing?.before ?? (p.title ? 4 : h === 1 ? 16 : h === 2 ? 13 : h > 0 ? 10 : 0);
    const lastItem = items[items.length - 1];
    lastItem.after = p.spacing?.after ?? (p.title ? 10 : h > 0 ? 6 : p.marker ? 3 : 7);
    if (h > 0 || p.title) lastItem.keepNext = true;
    if (p.bar) {
      const x = Math.max(0, textX - 9);
      items.forEach((it, i) => {
        const top = i === 0 ? -it.before : 0;
        const bottom = it.h + (i === items.length - 1 ? it.after : 0);
        it.cmds.unshift({ t: "line", x1: x, y1: top, x2: x, y2: bottom, width: 2.5, color: p.bar as string });
      });
    }
    if (p.box) {
      const bx = Math.max(0, textX - BOX_PAD);
      const bw = width - bx;
      const { bg, border } = p.box;
      items.forEach((it, i) => {
        const first = i === 0;
        const last = i === items.length - 1;
        const top = first ? -2 : 0;
        const bottom = it.h + (last ? 2 : 0);
        const pre: Cmd[] = [];
        if (bg) pre.push({ t: "rect", x: bx, y: top, w: bw, h: bottom - top, fill: bg });
        if (border) {
          const b = { width: border.width, color: border.color };
          if (!p.box?.bottomOnly) {
            pre.push({ t: "line", x1: bx, y1: top, x2: bx, y2: bottom, ...b });
            pre.push({ t: "line", x1: bx + bw, y1: top, x2: bx + bw, y2: bottom, ...b });
            if (first) pre.push({ t: "line", x1: bx, y1: top, x2: bx + bw, y2: top, ...b });
          }
          if (last) pre.push({ t: "line", x1: bx, y1: bottom, x2: bx + bw, y2: bottom, ...b });
        }
        it.cmds.unshift(...pre);
      });
    }
    if (p.anchor !== undefined) items[0].cmds.push({ t: "anchor", x: 0, y: 0, id: p.anchor });
  } else if (ctx.compact && items.length) {
    items[items.length - 1].after = p.marker ? 1 : 0;
  }
  return items;
}

// ---- tables ---------------------------------------------------------------------------------

function paraWidths(p: Para, ctx: Ctx, avail: number): { min: number; max: number } {
  const textX = p.marker ? (p.marker.base ?? LIST_BASE) + (p.marker.step ?? LIST_STEP) * p.marker.level : p.indent;
  const atoms = atomise(p, ctx, avail);
  let min = 0;
  let max = 0;
  let line = 0;
  for (const a of atoms) {
    if (a.k === "br") {
      max = Math.max(max, line);
      line = 0;
    } else {
      line += a.w;
      if (a.k !== "s") min = Math.max(min, a.w);
    }
  }
  max = Math.max(max, line);
  return { min: min + textX, max: max + textX };
}

function blockWidths(blocks: Block[], ctx: Ctx, avail: number): { min: number; max: number } {
  let min = 8;
  let max = 8;
  for (const b of blocks) {
    if (b.kind === "para") {
      const w = paraWidths(b, ctx, avail);
      min = Math.max(min, w.min);
      max = Math.max(max, w.max);
    } else if (b.kind === "table") {
      min = Math.max(min, 40);
      max = Math.max(max, avail);
    }
  }
  return { min, max };
}

function tableItems(t: TableBlock, width: number, ctx: Ctx): Item[] {
  // grid occupancy for row spans
  const rows = t.rows;
  const info = t.info;
  const cellCols = Math.max(
    1,
    ...rows.map((r) => r.cells.reduce((n, c) => n + c.colSpan, 0)),
  );
  const useGrid = !!info && info.grid.length >= cellCols;
  const cols = useGrid ? (info as NonNullable<typeof info>).grid.length : cellCols;
  const padX = info?.pad?.x ?? (info ? 5.4 : CELL_PAD_X);
  const padY = info?.pad?.y ?? (info ? 2 : CELL_PAD_Y);
  const pad = padX * 2;
  const border = info ? info.borders : { color: BORDER_COLOR, width: 0.5 };
  const mins = new Array<number>(cols).fill(8 + pad);
  const maxs = new Array<number>(cols).fill(8 + pad);
  for (const row of rows) {
    let col = 0;
    for (const cell of row.cells) {
      const cctx = { ...ctx, compact: true, bold: ctx.bold || (!info && cell.header) };
      const w = blockWidths(cell.blocks, cctx, width - pad);
      if (cell.colSpan === 1 && col < cols) {
        mins[col] = Math.max(mins[col], w.min + pad);
        maxs[col] = Math.max(maxs[col], w.max + pad);
      }
      col += cell.colSpan;
    }
  }
  // spanning cells: make sure their columns together are wide enough
  for (const row of rows) {
    let col = 0;
    for (const cell of row.cells) {
      if (cell.colSpan > 1) {
        const cctx = { ...ctx, compact: true, bold: ctx.bold || (!info && cell.header) };
        const w = blockWidths(cell.blocks, cctx, width - pad);
        const idx = Array.from({ length: cell.colSpan }, (_, k) => col + k).filter((k) => k < cols);
        const have = idx.reduce((n, k) => n + maxs[k], 0);
        const need = w.max + pad;
        if (need > have) for (const k of idx) maxs[k] += (need - have) / idx.length;
      }
      col += cell.colSpan;
    }
  }
  const sumMax = maxs.reduce((a, b) => a + b, 0);
  const sumMin = mins.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (useGrid && info) {
    const sumGrid = info.grid.reduce((a, b) => a + b, 0);
    const target = Math.min(
      info.widthPct ? (width * info.widthPct) / 100 : (info.widthPt ?? sumGrid),
      width,
    );
    widths = info.grid.map((g) => (g * target) / sumGrid);
  } else if (sumMax <= width) {
    const target = sumMax >= width * 0.5 ? width : sumMax * 1.4;
    widths = maxs.map((m) => (m / sumMax) * target);
  } else if (sumMin >= width) {
    widths = mins.map((m) => (m / sumMin) * width);
  } else {
    const spread = sumMax - sumMin;
    widths = mins.map((m, i) => m + ((width - sumMin) * (maxs[i] - m)) / spread);
  }
  const xs = [0];
  for (const w of widths) xs.push(xs[xs.length - 1] + w);
  const total = xs[xs.length - 1];

  const id = ctx.nextTable.n++;
  const cellCtx = (cell: Cell): Ctx => ({ ...ctx, compact: true, bold: ctx.bold || (!info && cell.header) });

  // 1. place every cell on the grid. A cell spanning rows blocks its columns in the rows below it.
  interface Placed {
    row: number;
    col: number;
    span: number;
    rows: number;
    cell: Cell;
    items: Item[];
    h: number;
    fill?: string;
  }
  const placedByRow: Placed[][] = rows.map(() => []);
  const blockedUntil = new Array<number>(cols).fill(-1); // last row index each column is taken to
  rows.forEach((row, ri) => {
    let col = 0;
    for (const cell of row.cells) {
      while (col < cols && blockedUntil[col] >= ri) col++;
      if (col >= cols) break;
      let span = Math.min(cell.colSpan, cols - col);
      // a column-span can't run into a column taken by a merge from above
      for (let k = 1; k < span; k++) if (blockedUntil[col + k] >= ri) span = k;
      const down = Math.max(1, Math.min(cell.rowSpan, rows.length - ri));
      const w = xs[col + span] - xs[col];
      // rotated text is one line of any length; it is turned into place when the row is drawn
      const inner = flowItems(cell.blocks, cell.rotate ? 1e5 : w - pad, cellCtx(cell));
      const h = cell.rotate ? 0 : inner.reduce((n, it) => n + it.before + it.h + it.after, 0);
      placedByRow[ri].push({ row: ri, col, span, rows: down, cell, items: inner, h, fill: cell.fill ?? (!info && cell.header ? HEADER_FILL : undefined) });
      for (let k = 0; k < span; k++) blockedUntil[col + k] = ri + down - 1;
      col += span;
    }
  });

  // 2. row heights from single-row cells; then a spanning cell's content stretches its last row
  const heights = rows.map((row, ri) => {
    if (row.exactHeight && row.minHeight !== undefined) {
      if (!row.autoFit) return row.minHeight;
      // only wrapped text grows the row: one line keeps Excel's height even where our font runs taller
      const wrapped = placedByRow[ri].filter((p) => p.rows === 1 && p.items.length > 1).map((p) => p.h + padY * 2);
      return Math.max(row.minHeight, ...wrapped);
    }
    const own = Math.max(0, ...placedByRow[ri].filter((p) => p.rows === 1).map((p) => p.h));
    return Math.max(info?.pad ? own : Math.max(own, BASE_SIZE * 1.22), (row.minHeight ?? 0) - padY * 2) + padY * 2;
  });
  for (const list of placedByRow) {
    for (const p of list) {
      if (p.rows === 1 || rows[p.row + p.rows - 1].exactHeight) continue;
      const have = heights.slice(p.row, p.row + p.rows).reduce((a, b) => a + b, 0);
      const need = p.h + padY * 2;
      if (need > have) heights[p.row + p.rows - 1] += need - have;
    }
  }
  const tops = [0];
  for (const h of heights) tops.push(tops[tops.length - 1] + h);

  // 3. one item per row; a spanning cell is drawn in its first row at its full height
  const items: Item[] = [];
  rows.forEach((row, ri) => {
    const cmds: Cmd[] = [];
    const height = heights[ri];
    const placed = placedByRow[ri];
    const boxH = (p: Placed) => tops[p.row + p.rows] - tops[p.row];
    // fills first so text draws on top
    for (const p of placed) {
      if (p.fill) cmds.push({ t: "rect", x: xs[p.col], y: 0, w: xs[p.col + p.span] - xs[p.col], h: boxH(p), fill: p.fill });
      p.cell.colFills?.forEach((fill, k) => {
        if (fill && k < p.span) cmds.push({ t: "rect", x: xs[p.col + k], y: 0, w: xs[p.col + k + 1] - xs[p.col + k], h: boxH(p), fill });
      });
      const bar = p.cell.bar;
      if (bar) {
        const w = xs[p.col + p.span] - xs[p.col] - padX * 2;
        cmds.push({ t: "rect", x: xs[p.col] + padX, y: 1, w: w * bar.frac, h: Math.max(0, boxH(p) - 2), fill: bar.color });
      }
    }
    for (const p of placed) {
      if (p.cell.rotate) {
        cmds.push(...rotated(p.items, p.cell, xs[p.col], xs[p.col + p.span] - xs[p.col], boxH(p), padX, padY, ctx.measure));
        continue;
      }
      const spare = boxH(p) - padY * 2 - p.h;
      const va = p.cell.valign;
      // a fixed-height row keeps centred and bottom-aligned text in place even when it overflows
      const fixed = rows[p.row + p.rows - 1].exactHeight;
      let y = padY + (spare > 0 || fixed ? (va === "bottom" ? spare : va === "middle" ? spare / 2 : 0) : 0);
      for (const it of p.items) {
        y += it.before;
        for (const c of it.cmds) cmds.push(shift(c, xs[p.col] + padX, y));
        y += it.h + it.after;
      }
    }
    if (border) {
      // verticals at every cell edge in this row (cells from merges above included), the table's
      // top on the first row, and a bottom under every column whose cell ends in this row
      const edges = new Set<number>([0, cols]);
      const ending: [number, number][] = [];
      for (let r = 0; r <= ri; r++) {
        for (const p of placedByRow[r]) {
          if (p.row + p.rows - 1 < ri) continue;
          edges.add(p.col);
          edges.add(p.col + p.span);
          if (p.row + p.rows - 1 === ri) ending.push([p.col, p.col + p.span]);
        }
      }
      for (const e of edges) cmds.push({ t: "line", x1: xs[e], y1: 0, x2: xs[e], y2: height, width: border.width, color: border.color });
      if (ri === 0) cmds.push({ t: "line", x1: 0, y1: 0, x2: total, y2: 0, width: border.width, color: border.color });
      const covered = new Array<boolean>(cols).fill(false);
      for (const [a, b] of ending) for (let k = a; k < b; k++) covered[k] = true;
      // columns no cell reaches (short rows) close the row too
      for (let k = 0; k < cols; k++) if (!covered[k] && blockedUntilRow(placedByRow, k, ri) < ri) covered[k] = true;
      for (let k = 0; k < cols; k++) {
        if (!covered[k]) continue;
        let e = k;
        while (e + 1 < cols && covered[e + 1]) e++;
        cmds.push({ t: "line", x1: xs[k], y1: height, x2: xs[e + 1], y2: height, width: border.width, color: border.color });
        k = e;
      }
    }
    for (const p of placed) {
      const e = p.cell.edges;
      if (!e) continue;
      const x1 = xs[p.col];
      const x2 = xs[p.col + p.span];
      const h = boxH(p);
      const line = (edge: Edge | undefined, a: number, b: number, d: number, f: number) => {
        if (!edge) return;
        if (!edge.double) {
          cmds.push({ t: "line", x1: a, y1: b, x2: d, y2: f, width: edge.width, color: edge.color, dash: edge.dash });
          return;
        }
        // two hairlines either side of the cell edge
        const [ox, oy] = a === d ? [0.75, 0] : [0, 0.75];
        for (const k of [-1, 1]) {
          cmds.push({ t: "line", x1: a + ox * k, y1: b + oy * k, x2: d + ox * k, y2: f + oy * k, width: 0.4, color: edge.color });
        }
      };
      line(e.top, x1, 0, x2, 0);
      line(e.bottom, x1, h, x2, h);
      line(e.left, x1, 0, x1, h);
      line(e.right, x2, 0, x2, h);
    }
    // rows a merged cell spans stay on one page with it
    const spanEnd = Math.max(ri, ...placed.map((p) => p.row + p.rows - 1));
    const keepWith = spanEnd > ri ? tops[spanEnd + 1] - tops[ri + 1] : 0;
    items.push({ h: height, before: 0, after: 0, cmds, isHeader: row.header, keepWith: keepWith || undefined, breakBefore: row.breakBefore });
  });

  // pictures over the cells, clipped to the table, drawn in the item of the row their top is in
  const tableH = tops[tops.length - 1];
  for (const pic of t.pictures ?? []) {
    const img = pic.inlines[0];
    if (!img || img.kind !== "image" || !items.length) continue;
    const rowAt = (a: { row: number; dy: number }) => {
      const r = Math.max(0, Math.min(rows.length - 1, a.row));
      return tops[r] + a.dy;
    };
    const y1 = rowAt(pic.top);
    const y2 = pic.bottom ? rowAt(pic.bottom) : y1 + (pic.h ?? 0);
    if (y2 - y1 < 0.5 || pic.w < 0.5) continue;
    // the row the top edge falls in (the first or last row when it is above or below the table)
    let r = 0;
    while (r < rows.length - 1 && tops[r + 1] <= y1) r++;
    items[r].cmds.push({
      t: "image",
      x: pic.x,
      y: y1 - tops[r],
      w: pic.w,
      h: y2 - y1,
      data: img.data,
      mime: img.mime,
      clip: { x: 0, y: -tops[r], w: total, h: tableH },
      above: true,
    });
  }
  if (info?.offsetX) for (const it of items) it.cmds = it.cmds.map((c) => shift(c, info.offsetX as number, 0));
  const headers = items.filter((i) => i.isHeader);
  items.forEach((i) => (i.table = { id, headers }));
  if (items.length) items[items.length - 1].after = ctx.compact ? 0 : 8;
  if (items.length) items[0].before = ctx.compact ? 0 : 4;
  return items;
}

/**
 * A cell's one line of text turned by its angle and placed, as a box, by the cell's alignment
 * (horizontal from its paragraph, vertical from the cell).
 */
function rotated(items: Item[], cell: Cell, x: number, w: number, h: number, padX: number, padY: number, measure: Measurer): Cmd[] {
  const texts: Extract<Cmd, { t: "text" }>[] = [];
  let y = 0;
  for (const it of items) {
    y += it.before;
    for (const c of it.cmds) if (c.t === "text") texts.push(shift(c, 0, y) as Extract<Cmd, { t: "text" }>);
    y += it.h + it.after;
  }
  if (!texts.length) return [];
  const lineH = y;
  const left = Math.min(...texts.map((c) => c.x));
  const len = Math.max(...texts.map((c) => c.x + measure(c.text, { family: c.family, bold: c.bold, italic: c.italic }, c.size))) - left;
  const a = ((cell.rotate ?? 0) * Math.PI) / 180;
  const [cos, sin] = [Math.cos(a), Math.sin(a)];
  // text-frame (u right along the line, v down) to page offsets from the origin
  const at = (u: number, v: number) => [u * cos + v * sin, -u * sin + v * cos];
  const corners = [at(0, 0), at(len, 0), at(0, lineH), at(len, lineH)];
  const minX = Math.min(...corners.map((c) => c[0]));
  const maxX = Math.max(...corners.map((c) => c[0]));
  const minY = Math.min(...corners.map((c) => c[1]));
  const maxY = Math.max(...corners.map((c) => c[1]));
  const para = cell.blocks.find((b) => b.kind === "para");
  const align = para?.kind === "para" ? para.align : "left";
  const spareX = w - padX * 2 - (maxX - minX);
  const spareY = h - padY * 2 - (maxY - minY);
  const ox = x + padX - minX + (align === "right" ? spareX : align === "center" ? spareX / 2 : 0);
  const va = cell.valign ?? "bottom";
  const oy = padY - minY + (va === "bottom" ? spareY : va === "middle" ? spareY / 2 : 0);
  return texts.map((c) => {
    const [dx, dy] = at(c.x - left, c.y);
    return { ...c, x: ox + dx, y: oy + dy, rotate: cell.rotate };
  });
}

/** The last row a cell placed at or above `row` takes in column `col`, or -1. */
function blockedUntilRow(placed: { col: number; span: number; row: number; rows: number }[][], col: number, row: number): number {
  let until = -1;
  for (let r = 0; r <= row; r++) {
    for (const p of placed[r]) if (col >= p.col && col < p.col + p.span) until = Math.max(until, p.row + p.rows - 1);
  }
  return until;
}

function shift(c: Cmd, dx: number, dy: number): Cmd {
  switch (c.t) {
    case "line":
      return { ...c, x1: c.x1 + dx, x2: c.x2 + dx, y1: c.y1 + dy, y2: c.y2 + dy };
    case "image":
      return { ...c, x: c.x + dx, y: c.y + dy, clip: c.clip && { ...c.clip, x: c.clip.x + dx, y: c.clip.y + dy } };
    default:
      return { ...c, x: c.x + dx, y: c.y + dy };
  }
}

function flowItems(blocks: Block[], width: number, ctx: Ctx): Item[] {
  const out: Item[] = [];
  for (const b of blocks) {
    if (b.kind === "para") out.push(...paraItems(b, width, ctx));
    else if (b.kind === "table") out.push(...tableItems(b, width, ctx));
    else out.push({ h: 0, before: 0, after: 0, cmds: [], forceBreak: true });
  }
  return out;
}

// ---- pages ----------------------------------------------------------------------------------

export interface LayoutOptions {
  /** natural line height as a multiple of the font size */
  lineFactor?: (key: FontKey) => number;
}

export function layoutDocument(
  blocks: Block[],
  page: PageSpec,
  measure: Measurer,
  opts: LayoutOptions = {},
): LaidOutPage[] {
  const left = page.margin.left;
  const width = page.width - page.margin.left - page.margin.right;
  const top = page.margin.top;
  const bottom = page.height - page.margin.bottom;
  const ctx: Ctx = {
    measure,
    compact: false,
    bold: false,
    maxImgH: (bottom - top) * 0.9,
    nextTable: { n: 0 },
    lineFactor: opts.lineFactor ?? (() => 1.22),
  };
  const items = flowItems(blocks, width, ctx);

  const pages: LaidOutPage[] = [{ cmds: [] }];
  let y = top;
  let used = false;
  let pendingBreak = false;
  let prevTable = -1;

  const emit = (it: Item, at: number) => {
    const cur = pages[pages.length - 1];
    for (const c of it.cmds) cur.cmds.push(shift(c, left, at));
  };
  const newPage = () => {
    pages.push({ cmds: [] });
    y = top;
    used = false;
  };

  items.forEach((it, idx) => {
    if (it.forceBreak) {
      pendingBreak = true;
      return;
    }
    if (pendingBreak) {
      if (used) newPage();
      pendingBreak = false;
    }
    const next = items[idx + 1];
    let before = used ? it.before : 0;
    const lookahead = Math.max(it.keepNext && next && !next.forceBreak ? it.after + next.before + next.h : 0, it.keepWith ?? 0);
    if ((it.breakBefore || y + before + it.h + lookahead > bottom) && used) {
      newPage();
      before = 0;
      if (it.table && !it.isHeader && it.table.id === prevTable) {
        for (const hdr of it.table.headers) {
          emit(hdr, y);
          y += hdr.h;
        }
      }
    }
    emit(it, y + before);
    y += before + it.h + it.after;
    used = true;
    prevTable = it.table ? it.table.id : -1;
  });
  // pictures that sit over cells go last, so cells drawn later on the page don't cover them
  for (const p of pages) {
    if (p.cmds.some((c) => c.t === "image" && c.above)) {
      p.cmds = [...p.cmds.filter((c) => !(c.t === "image" && c.above)), ...p.cmds.filter((c) => c.t === "image" && c.above)];
    }
  }
  return pages;
}
