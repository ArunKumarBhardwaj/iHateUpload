import type { Line, PageImage } from "./lines";
import type { TableEl } from "./tables";

/** Which side-by-side text columns an element sits in. */
export type Region = { id: number; index: number; boxes: { x0: number; x1: number }[] };

type Box = { x0: number; x1: number; top: number; bottom: number; region?: Region };

export type El =
  | ({ kind: "line"; line: Line } & Box)
  | ({ kind: "table"; table: TableEl } & Box)
  | ({ kind: "image"; image: PageImage } & Box);

export const lineEl = (line: Line): El => ({
  kind: "line",
  line,
  x0: line.x0,
  x1: line.x1,
  top: line.top,
  bottom: line.bottom,
});
export const tableEl = (table: TableEl): El => ({
  kind: "table",
  table,
  x0: table.x0,
  x1: table.x1,
  top: table.y0,
  bottom: table.y1,
});
export const imageEl = (image: PageImage): El => ({
  kind: "image",
  image,
  x0: image.x,
  x1: image.x + image.w,
  top: image.y,
  bottom: image.y + image.h,
});

const MIN_GUTTER = 12;

function distinctRows(els: El[]): number {
  const tops = els.map((e) => Math.round(e.top / 4)).sort((a, b) => a - b);
  return new Set(tops).size;
}

/** A real column has runs of lines stacked tightly; a column of right-aligned dates does not. */
function holdsText(els: El[]): boolean {
  if (els.some((e) => e.kind !== "line")) return true;
  const sorted = [...els].sort((a, b) => a.top - b.top);
  let pairs = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    if (sorted[i].top - prev.bottom <= prev.bottom - prev.top) pairs++;
  }
  return pairs >= 2;
}

function splitVertical(els: El[]): El[][] | null {
  const sorted = [...els].sort((a, b) => a.x0 - b.x0);
  const groups: El[][] = [];
  let reach = -Infinity;
  for (const el of sorted) {
    if (groups.length && el.x0 - reach < MIN_GUTTER) {
      groups[groups.length - 1].push(el);
      reach = Math.max(reach, el.x1);
    } else {
      groups.push([el]);
      reach = el.x1;
    }
  }
  if (groups.length < 2) return null;
  if (groups.some((g) => distinctRows(g) < 3 || !holdsText(g))) return null;
  return groups;
}

/**
 * A short title can sit over one column without reaching across the gutter. When the group
 * only splits into columns once a few rows at its top are set aside, those rows are a band
 * of their own.
 */
function peelHead(els: El[]): [El[], El[]] | null {
  const sorted = [...els].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  for (let i = 1; i < sorted.length; i++) {
    const head = sorted.slice(0, i);
    if (head.length > 3 || distinctRows(head) > 2) return null;
    const rest = sorted.slice(i);
    const headBottom = Math.max(...head.map((e) => e.bottom));
    const lineHeight = Math.max(...head.map((e) => e.bottom - e.top));
    if (Math.min(...rest.map((e) => e.top)) < headBottom + 0.5 * lineHeight) continue;
    if (splitVertical(rest)) return [head, rest];
  }
  return null;
}

function splitHorizontal(els: El[]): [El[], El[]] | null {
  const sorted = [...els].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  let reach = -Infinity;
  let best = -1;
  let bestGap = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0) {
      const gap = sorted[i].top - reach;
      if (gap >= 0 && gap > bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    reach = Math.max(reach, sorted[i].bottom);
  }
  if (best < 0) return null;
  return [sorted.slice(0, best), sorted.slice(best)];
}

/**
 * Reading order by recursive XY-cut: split on a clear vertical gutter when
 * every side holds a real column, otherwise on the widest horizontal gap.
 * Lines learn which column they ended up in.
 */
export function readingOrder(els: El[], colL: number, colR: number): El[] {
  const out: El[] = [];
  let regions = 0;
  const visit = (group: El[], l: number, r: number, region?: Region, peel = true) => {
    if (group.length === 1) {
      const el = group[0];
      if (region) el.region = region;
      if (el.kind === "line") {
        el.line.colL = l;
        el.line.colR = r;
      }
      out.push(el);
      return;
    }
    const head = peel ? peelHead(group) : null;
    if (head) {
      visit(head[0], l, r, region);
      visit(head[1], l, r, region, false);
      return;
    }
    const columns = splitVertical(group);
    if (columns) {
      const boxes = columns.map((c) => ({
        x0: Math.min(...c.map((e) => e.x0)),
        x1: Math.max(...c.map((e) => e.x1)),
      }));
      const id = ++regions;
      columns.forEach((column, index) => {
        const box = textBox(column);
        // Columns inside a column are read in order but stay part of the outer one.
        visit(column, box ? box[0] : l, box ? box[1] : r, region ?? { id, index, boxes });
      });
      return;
    }
    const bands = splitHorizontal(group);
    if (bands) {
      visit(bands[0], l, r, region);
      visit(bands[1], l, r, region);
      return;
    }
    // Overlapping blocks that cannot be separated: top to bottom, then left to right.
    for (const el of [...group].sort((a, b) => a.top - b.top || a.x0 - b.x0)) visit([el], l, r, region);
  };
  if (els.length) visit(els, colL, colR);
  return out;
}

function textBox(els: El[]): [number, number] | null {
  const lines = els.filter((e) => e.kind === "line");
  if (!lines.length) return null;
  return [Math.min(...lines.map((e) => e.x0)), Math.max(...lines.map((e) => e.x1))];
}
