/**
 * Flow layout: blocks in, positioned drawing commands out. Pure and font-agnostic: the caller
 * supplies a text measurer, so the same code runs against pdf-lib fonts and in unit tests.
 * Coordinates in the output are top-down from the page's top-left corner, in points.
 */
import type { Align, Block, Family, Inline, InlineStyle, LineSpec, Para, TableBlock } from "./model";
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
    }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number; width: number; color: string }
  | { t: "rect"; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; strokeWidth?: number }
  /** an SVG path in page coordinates (top-down), used by the slide renderer */
  | { t: "shape"; x: number; y: number; path: string; fill?: string; stroke?: string; strokeWidth?: number }
  /** invisible marker for a heading, so a table of contents can find its page */
  | { t: "anchor"; x: number; y: number; id: number }
  | { t: "image"; x: number; y: number; w: number; h: number; data: Uint8Array; mime: string }
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
  forceBreak?: boolean;
  table?: { id: number; headers: Item[] };
  isHeader?: boolean;
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
  | { k: "s"; w: number; r: Resolved }
  | { k: "i"; w: number; h: number; data: Uint8Array; mime: string; href?: string }
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
      atoms.push({ k: "i", w, h, data: inl.data, mime: inl.mime });
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
          atoms.push({ k: "s", w: ctx.measure(" ", r.key, r.size), r });
        } else {
          const text = clean(tok);
          if (text) atoms.push({ k: "w", text, w: ctx.measure(text, r.key, r.size), r });
        }
      }
    }
  }
  return atoms;
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
  for (const a of atoms) {
    if (a.k === "i") imgH = Math.max(imgH, a.h);
    else if (a.k === "w" || a.k === "s") {
      maxSize = Math.max(maxSize, a.r.size);
      natural = Math.max(natural, a.r.size * ctx.lineFactor(a.r.key));
    }
  }
  if (!maxSize) maxSize = fallbackSize;
  if (!natural) natural = maxSize * 1.22;
  const descent = maxSize * 0.25;
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
      cmds.push({ t: "image", x, y: baseline - a.h, w: a.w, h: a.h, data: a.data, mime: a.mime });
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
        run.text += a.k === "w" ? a.text : " ";
        run.w += w;
      } else {
        flush();
        run = { text: a.k === "w" ? a.text : " ", x, w, r: a.r };
      }
      x += w;
    }
  }
  flush();
  return { h: lineH, before: 0, after: 0, cmds };
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
  const atoms = atomise(p, ctx, avail);
  const lines = breakLines(atoms, avail, ctx);
  const size = baseSizeOf(p);
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
  const padX = info ? 5.4 : CELL_PAD_X;
  const padY = info ? 2 : CELL_PAD_Y;
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
  const items: Item[] = [];
  const occupied = new Array<number>(cols).fill(0);
  rows.forEach((row, ri) => {
    const cmds: Cmd[] = [];
    const bodies: { x: number; items: Item[]; h: number }[] = [];
    let rowH = 0;
    let col = 0;
    const placed: { col: number; span: number; fill?: string }[] = [];
    for (const cell of row.cells) {
      while (col < cols && occupied[col] > 0) col++;
      if (col >= cols) break;
      const span = Math.min(cell.colSpan, cols - col);
      const w = xs[col + span] - xs[col];
      const cctx: Ctx = { ...ctx, compact: true, bold: ctx.bold || (!info && cell.header) };
      const inner = flowItems(cell.blocks, w - pad, cctx);
      const h = inner.reduce((n, it) => n + it.before + it.h + it.after, 0);
      bodies.push({ x: xs[col] + padX, items: inner, h });
      rowH = Math.max(rowH, h);
      placed.push({ col, span, fill: cell.fill ?? (!info && cell.header ? HEADER_FILL : undefined) });
      if (cell.rowSpan > 1) for (let k = 0; k < span; k++) occupied[col + k] = cell.rowSpan;
      col += span;
    }
    for (let k = 0; k < cols; k++) if (occupied[k] > 0 && !placed.some((c) => k >= c.col && k < c.col + c.span)) occupied[k]--;
    const height = Math.max(rowH, BASE_SIZE * 1.22) + padY * 2;
    // fills first so text draws on top
    placed.forEach((c) => {
      if (c.fill) cmds.push({ t: "rect", x: xs[c.col], y: 0, w: xs[c.col + c.span] - xs[c.col], h: height, fill: c.fill });
    });
    bodies.forEach((b) => {
      let y = padY;
      for (const it of b.items) {
        y += it.before;
        for (const c of it.cmds) cmds.push(shift(c, b.x, y));
        y += it.h + it.after;
      }
    });
    // borders: verticals at every cell edge (or the table edge), top on the first row, bottom always
    const edges = new Set<number>([0, cols]);
    placed.forEach((c) => {
      edges.add(c.col);
      edges.add(c.col + c.span);
    });
    if (border) {
      for (const e of edges) cmds.push({ t: "line", x1: xs[e], y1: 0, x2: xs[e], y2: height, width: border.width, color: border.color });
      if (ri === 0) cmds.push({ t: "line", x1: 0, y1: 0, x2: total, y2: 0, width: border.width, color: border.color });
      cmds.push({ t: "line", x1: 0, y1: height, x2: total, y2: height, width: border.width, color: border.color });
    }
    items.push({ h: height, before: 0, after: 0, cmds, isHeader: row.header });
  });
  const headers = items.filter((i) => i.isHeader);
  items.forEach((i) => (i.table = { id, headers }));
  if (items.length) items[items.length - 1].after = ctx.compact ? 0 : 8;
  if (items.length) items[0].before = ctx.compact ? 0 : 4;
  return items;
}

function shift(c: Cmd, dx: number, dy: number): Cmd {
  switch (c.t) {
    case "line":
      return { ...c, x1: c.x1 + dx, x2: c.x2 + dx, y1: c.y1 + dy, y2: c.y2 + dy };
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
    const lookahead = it.keepNext && next && !next.forceBreak ? it.after + next.before + next.h : 0;
    if (y + before + it.h + lookahead > bottom && used) {
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
  return pages;
}
