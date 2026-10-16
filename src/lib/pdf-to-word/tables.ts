import {
  lineFromFrags,
  lineText,
  matchMarker,
  type Fill,
  type Frag,
  type Line,
  type Rule,
} from "./lines";

export type GridCell = {
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  lines: Line[];
  /** Rules on this cell's own edges, when the table does not draw every edge. */
  borders?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
};

export type TableEl = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Column and row boundaries. */
  xs: number[];
  ys: number[];
  cells: GridCell[];
  borders: boolean;
  /** Hex colour of the rules, when the page says. */
  borderColor?: string;
};

const TOL = 2.5;

type HLine = { y: number; x0: number; x1: number; color?: string };
type VLine = { x: number; y0: number; y1: number; color?: string };

/** The colour most of the rules are drawn in, when they say. */
function commonColor(rules: { color?: string }[]): string | undefined {
  const count = new Map<string, number>();
  for (const r of rules) if (r.color) count.set(r.color, (count.get(r.color) ?? 0) + 1);
  let best: string | undefined;
  let top = 0;
  for (const [color, n] of count) {
    if (n > top) {
      top = n;
      best = color;
    }
  }
  return best;
}

function dedupe(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length && v - out[out.length - 1] <= tol) {
      out[out.length - 1] = (out[out.length - 1] + v) / 2;
    } else out.push(v);
  }
  return out;
}

function mergeH(lines: HLine[]): HLine[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const out: HLine[] = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - l.y) <= 1.5 && l.x0 <= last.x1 + 2) {
      last.x1 = Math.max(last.x1, l.x1);
    } else out.push({ ...l });
  }
  return out;
}

function mergeV(lines: VLine[]): VLine[] {
  const sorted = [...lines].sort((a, b) => a.x - b.x || a.y0 - b.y0);
  const out: VLine[] = [];
  for (const l of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - l.x) <= 1.5 && l.y0 <= last.y1 + 2) {
      last.y1 = Math.max(last.y1, l.y1);
    } else out.push({ ...l });
  }
  return out;
}

/** Pull the pieces whose centre satisfies `inside` out of the lines. */
function takeFrags(
  lines: Line[],
  inside: (frag: Frag, line: Line) => boolean,
): { taken: { frag: Frag; line: Line }[]; rest: Line[] } {
  const taken: { frag: Frag; line: Line }[] = [];
  const rest: Line[] = [];
  for (const line of lines) {
    const kept: Frag[] = [];
    for (const frag of line.frags) {
      if (inside(frag, line)) taken.push({ frag, line });
      else kept.push(frag);
    }
    if (kept.length === line.frags.length) rest.push(line);
    else if (kept.length) {
      const rebuilt = lineFromFrags(kept, line.row, line.baseline);
      rest.push(rebuilt);
    }
  }
  return { taken, rest };
}

/** Group loose pieces into lines inside one cell. */
function linesFromPieces(pieces: { frag: Frag; line: Line }[], x0: number, x1: number) {
  const sorted = [...pieces].sort(
    (a, b) => a.line.baseline - b.line.baseline || a.frag.x0 - b.frag.x0,
  );
  const groups: { baseline: number; size: number; frags: Frag[]; row: number }[] = [];
  for (const piece of sorted) {
    const g = groups[groups.length - 1];
    if (
      g &&
      Math.abs(g.baseline - piece.line.baseline) <= 0.42 * Math.max(g.size, piece.frag.size)
    ) {
      g.frags.push(piece.frag);
      g.size = Math.max(g.size, piece.frag.size);
    } else {
      groups.push({
        baseline: piece.line.baseline,
        size: piece.frag.size,
        frags: [piece.frag],
        row: piece.line.row,
      });
    }
  }
  return groups.map((g) => {
    const line = lineFromFrags(g.frags.sort((a, b) => a.x0 - b.x0), g.row, g.baseline);
    line.colL = x0;
    line.colR = x1;
    return line;
  });
}

export function detectRuledTables(
  lines: Line[],
  rules: Rule[],
): { tables: TableEl[]; rest: Line[] } {
  const hs: HLine[] = [];
  const vs: VLine[] = [];
  for (const r of rules) {
    const w = r.x1 - r.x0;
    const h = r.y1 - r.y0;
    if (h <= 1.5 && w >= 6) hs.push({ y: (r.y0 + r.y1) / 2, x0: r.x0, x1: r.x1, color: r.color });
    else if (w <= 1.5 && h >= 6) vs.push({ x: (r.x0 + r.x1) / 2, y0: r.y0, y1: r.y1, color: r.color });
  }
  const H = mergeH(hs);
  const V = mergeV(vs);
  if (H.length < 2 || V.length < 2) return { tables: [], rest: lines };

  // Union lines that cross each other.
  const parent = [...H, ...V].map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  H.forEach((h, i) =>
    V.forEach((v, j) => {
      if (
        v.x >= h.x0 - TOL &&
        v.x <= h.x1 + TOL &&
        h.y >= v.y0 - TOL &&
        h.y <= v.y1 + TOL
      ) {
        parent[find(i)] = find(H.length + j);
      }
    }),
  );
  const clusters = new Map<number, { h: HLine[]; v: VLine[] }>();
  H.forEach((h, i) => {
    const key = find(i);
    (clusters.get(key) ?? clusters.set(key, { h: [], v: [] }).get(key)!).h.push(h);
  });
  V.forEach((v, j) => {
    const key = find(H.length + j);
    (clusters.get(key) ?? clusters.set(key, { h: [], v: [] }).get(key)!).v.push(v);
  });

  const tables: TableEl[] = [];
  let rest = lines;
  for (const cluster of clusters.values()) {
    const xs = dedupe(cluster.v.map((v) => v.x), TOL);
    const ys = dedupe(cluster.h.map((h) => h.y), TOL);
    if (xs.length < 2 || ys.length < 2) continue;
    if ((xs.length - 1) * (ys.length - 1) < 2) continue;
    const rows = ys.length - 1;
    const cols = xs.length - 1;

    const hasV = (boundary: number, row: number) => {
      if (boundary === 0 || boundary === cols) return true;
      const lo = ys[row];
      const hi = ys[row + 1];
      return cluster.v.some(
        (v) =>
          Math.abs(v.x - xs[boundary]) <= TOL &&
          Math.min(v.y1, hi) - Math.max(v.y0, lo) >= (hi - lo) * 0.7,
      );
    };
    const hasH = (boundary: number, col: number) => {
      if (boundary === 0 || boundary === rows) return true;
      const lo = xs[col];
      const hi = xs[col + 1];
      return cluster.h.some(
        (h) =>
          Math.abs(h.y - ys[boundary]) <= TOL &&
          Math.min(h.x1, hi) - Math.max(h.x0, lo) >= (hi - lo) * 0.7,
      );
    };

    const owner: (GridCell | null)[][] = Array.from({ length: rows }, () =>
      Array<GridCell | null>(cols).fill(null),
    );
    const cells: GridCell[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (owner[r][c]) continue;
        let colSpan = 1;
        while (c + colSpan < cols && !hasV(c + colSpan, r) && !owner[r][c + colSpan]) {
          colSpan++;
        }
        let rowSpan = 1;
        while (r + rowSpan < rows) {
          let open = true;
          for (let k = c; k < c + colSpan; k++) if (hasH(r + rowSpan, k)) open = false;
          for (let k = c; k < c + colSpan; k++) if (owner[r + rowSpan][k]) open = false;
          if (!open) break;
          rowSpan++;
        }
        const cell: GridCell = {
          row: r,
          col: c,
          rowSpan,
          colSpan,
          x0: xs[c],
          y0: ys[r],
          x1: xs[c + colSpan],
          y1: ys[r + rowSpan],
          lines: [],
        };
        for (let i = r; i < r + rowSpan; i++) {
          for (let k = c; k < c + colSpan; k++) owner[i][k] = cell;
        }
        cells.push(cell);
      }
    }

    const bx0 = xs[0] - TOL;
    const bx1 = xs[cols] + TOL;
    const by0 = ys[0] - TOL;
    const by1 = ys[rows] + TOL;
    const { taken, rest: remaining } = takeFrags(rest, (frag, line) => {
      const cx = (frag.x0 + frag.x1) / 2;
      const cy = line.baseline - line.size * 0.3;
      return cx >= bx0 && cx <= bx1 && cy >= by0 && cy <= by1;
    });
    rest = remaining;
    const byCell = new Map<GridCell, { frag: Frag; line: Line }[]>();
    for (const piece of taken) {
      const cx = (piece.frag.x0 + piece.frag.x1) / 2;
      const cy = piece.line.baseline - piece.line.size * 0.3;
      let c = xs.findIndex((x, i) => i < cols && cx >= x - TOL && cx <= xs[i + 1] + TOL);
      let r = ys.findIndex((y, i) => i < rows && cy >= y - TOL && cy <= ys[i + 1] + TOL);
      if (c < 0) c = 0;
      if (r < 0) r = 0;
      const cell = owner[r][c]!;
      (byCell.get(cell) ?? byCell.set(cell, []).get(cell)!).push(piece);
    }
    for (const [cell, pieces] of byCell) {
      cell.lines = linesFromPieces(pieces, cell.x0 + 3, cell.x1 - 3);
    }
    tables.push({
      x0: xs[0],
      y0: ys[0],
      x1: xs[cols],
      y1: ys[rows],
      xs,
      ys,
      cells,
      borders: true,
      borderColor: commonColor([...cluster.h, ...cluster.v]),
    });
  }
  return { tables, rest };
}


const wordsIn = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export type ColumnAlign = "left" | "center" | "right";

type Span = { x0: number; x1: number };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/** True when three quarters of the values sit within `tol` of their median. */
function lineUp(values: number[], tol: number): boolean {
  const m = median(values);
  return values.filter((v) => Math.abs(v - m) <= tol).length >= values.length * 0.75;
}

/**
 * How the text of one column lines up. Right and centre only count when the left edges are ragged,
 * so a column of equal-width dates stays left.
 */
export function columnAlign(spans: Span[], tol = 2): ColumnAlign {
  if (spans.length < 2) return "left";
  if (lineUp(spans.map((s) => s.x0), tol)) return "left";
  if (lineUp(spans.map((s) => s.x1), tol)) return "right";
  if (lineUp(spans.map((s) => (s.x0 + s.x1) / 2), tol)) return "center";
  return "left";
}

/** Column extents: pieces that overlap across rows are one column. */
function clusterColumns(rows: Line[][]): Span[] {
  const spans = rows.flat().map((l) => ({ x0: l.x0, x1: l.x1 })).sort((a, b) => a.x0 - b.x0);
  const cols: Span[] = [];
  for (const s of spans) {
    const last = cols[cols.length - 1];
    if (last && s.x0 <= last.x1) last.x1 = Math.max(last.x1, s.x1);
    else cols.push({ ...s });
  }
  return cols;
}

/** The column each piece of a row falls in, or null when a piece straddles columns or two share one. */
function mapRow(row: Line[], cols: Span[]): number[] | null {
  const out: number[] = [];
  for (const piece of row) {
    const c = cols.findIndex((k) => piece.x0 >= k.x0 - 1.5 && piece.x1 <= k.x1 + 1.5);
    if (c < 0 || (out.length && c <= out[out.length - 1])) return null;
    out.push(c);
  }
  return out;
}

type Found = { start: number; end: number; cols: Span[]; maps: number[][] };

/**
 * A run of consecutive rows read as a table. Rows with the most pieces (at least three of them) set
 * the columns; rows with fewer pieces stay in when each piece sits inside one of those columns, so a
 * totals row with empty middle cells keeps its amount in the right column.
 */
function findTable(run: Line[][]): Found | null {
  const counts = run.map((r) => r.length);
  let width = 0;
  for (let k = 8; k >= 2; k--) {
    if (counts.filter((c) => c >= k).length >= 3) {
      width = k;
      break;
    }
  }
  if (!width) return null;
  const start = counts.findIndex((c) => c >= width);
  let limit = run.length;
  for (let attempt = 0; attempt < 4; attempt++) {
    const core = run.slice(start, limit).filter((r) => r.length >= width);
    if (core.length < 3) return null;
    const cols = clusterColumns(core);
    if (cols.length < 2) return null;
    const maps: number[][] = [];
    let end = start - 1;
    for (let k = start; k < limit; k++) {
      const m = mapRow(run[k], cols);
      if (!m) break;
      maps.push(m);
      end = k;
    }
    if (end === limit - 1) {
      if (run.slice(start, end + 1).filter((r) => r.length >= width).length < 3) return null;
      return { start, end, cols, maps };
    }
    limit = end + 1;
  }
  return null;
}

type Horizontal = { y: number; segs: Span[]; color?: string };

/** Horizontal rules grouped by height, each with the stretches it covers. */
function horizontals(rules: Rule[]): Horizontal[] {
  const out: Horizontal[] = [];
  for (const r of [...rules].sort((a, b) => a.y0 - b.y0)) {
    if (Math.abs(r.y1 - r.y0) > 0.6 || r.x1 - r.x0 < 6) continue;
    const y = (r.y0 + r.y1) / 2;
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - y) <= 1.5) {
      last.segs.push({ x0: r.x0, x1: r.x1 });
      last.color ??= r.color;
    } else out.push({ y, segs: [{ x0: r.x0, x1: r.x1 }], color: r.color });
  }
  return out;
}

/** How much of [x0, x1] the stretches cover. */
function covered(segs: Span[], x0: number, x1: number): number {
  const sorted = segs.filter((s) => s.x1 > x0 && s.x0 < x1).sort((a, b) => a.x0 - b.x0);
  let total = 0;
  let reach = x0;
  for (const s of sorted) {
    const from = Math.max(s.x0, reach);
    const to = Math.min(s.x1, x1);
    if (to > from) {
      total += to - from;
      reach = to;
    }
  }
  return total;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Rows of pieces that line up in columns, with or without lines. The rules and painted bands that
 * sit on the row and column boundaries are read here too, so they become the table's own borders
 * and shading and are not left over as separate shapes.
 */
export function detectBorderlessTables(
  lines: Line[],
  rules: Rule[] = [],
  fills: Fill[] = [],
): { tables: TableEl[]; rest: Line[] } {
  const byRow = new Map<number, Line[]>();
  for (const line of lines) (byRow.get(line.row) ?? byRow.set(line.row, []).get(line.row)!).push(line);
  const rows = [...byRow.values()]
    .map((r) => r.sort((a, b) => a.x0 - b.x0))
    .sort((a, b) => a[0].baseline - b[0].baseline);

  const tables: TableEl[] = [];
  const used = new Set<Line>();
  const hs = horizontals(rules);
  const candidate = (row: Line[]) => row.length >= 2 && row.length <= 8;

  const valid = (block: Line[][], cols: Span[], maps: number[][]) => {
    if (block.length < 3) return false;
    for (let c = 0; c < cols.length; c++) {
      const cell = block.flatMap((row, r) => row.filter((_, k) => maps[r][k] === c));
      if (cell.length < 2) continue;
      const tol = Math.max(4, cell[0].size * 0.4);
      const ok =
        lineUp(cell.map((l) => l.x0), tol) ||
        lineUp(cell.map((l) => l.x1), tol) ||
        lineUp(cell.map((l) => (l.x0 + l.x1) / 2), tol);
      if (!ok) return false;
      // Several multi-word cells that all end at one edge are a justified column of text, not data.
      const wordy = cell.filter((l) => wordsIn(lineText(l)) >= 4);
      if (wordy.length >= 3 && lineUp(wordy.map((l) => l.x1), 2)) return false;
    }
    const counts = block.flat().map((l) => wordsIn(lineText(l)));
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    if (Math.max(...counts) > 8 || mean > 5) return false;
    return !block.every((row) => matchMarker(lineText(row[0])) !== null);
  };

  let i = 0;
  while (i < rows.length) {
    if (!candidate(rows[i])) {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < rows.length &&
      candidate(rows[j + 1]) &&
      rows[j + 1][0].baseline - rows[j][0].baseline <= rows[j][0].size * 2.4 &&
      rows[j + 1][0].baseline - rows[j][0].baseline >= rows[j][0].size * 0.6
    ) {
      j++;
    }
    const found = findTable(rows.slice(i, j + 1));
    if (!found) {
      i++;
      continue;
    }
    const block = rows.slice(i + found.start, i + found.end + 1);
    if (!valid(block, found.cols, found.maps)) {
      i++;
      continue;
    }
    tables.push(buildBorderless(block, found.cols, found.maps, hs, fills, used));
    i += found.end + 1;
  }
  return { tables, rest: lines.filter((l) => !used.has(l)) };
}

function buildBorderless(
  block: Line[][],
  cols: Span[],
  maps: number[][],
  hs: Horizontal[],
  fills: Fill[],
  used: Set<Line>,
): TableEl {
  const R = block.length;
  const C = cols.length;
  const lefts = cols.map((c) => c.x0);
  const rights = cols.map((c) => c.x1);
  const aligns = cols.map((_, c) =>
    columnAlign(block.flatMap((row, r) => row.filter((_, k) => maps[r][k] === c))),
  );
  const rowTop = block.map((r) => Math.min(...r.map((l) => l.top)));
  const rowBottom = block.map((r) => Math.max(...r.map((l) => l.bottom)));
  const half = R > 1 ? Math.max(0, (rowTop[1] - rowBottom[0]) / 2) : 2;
  const pitch = R > 1 ? (rowTop[R - 1] - rowTop[0]) / (R - 1) : rowBottom[0] - rowTop[0] + 4;
  const textL = lefts[0];
  const textR = rights[C - 1];
  const textW = Math.max(1, textR - textL);

  // Painted bands behind rows of the table.
  const bands = fills.filter((f) => {
    const h = f.y1 - f.y0;
    return h > 4 && h <= 4 * pitch && f.x1 > textL && f.x0 < textR && f.x1 - f.x0 <= 1.3 * (textW + 40);
  });
  const bandsOf = (r: number) =>
    bands.filter((f) => f.y0 - 1 <= (rowTop[r] + rowBottom[r]) / 2 && f.y1 + 1 >= (rowTop[r] + rowBottom[r]) / 2);

  const ys: number[] = [];
  const chosen: (Horizontal | null)[] = [];
  const reach = 2 * half + 4;
  for (let b = 0; b <= R; b++) {
    const lo = b === 0 ? rowTop[0] - reach : rowBottom[b - 1] - 1;
    const hi = b === R ? rowBottom[R - 1] + reach : rowTop[b] + 1;
    const fallback =
      b === 0 ? rowTop[0] - half : b === R ? rowBottom[R - 1] + half : (rowBottom[b - 1] + rowTop[b]) / 2;
    let best: Horizontal | null = null;
    let bestScore = 0;
    for (const h of hs) {
      if (h.y < lo || h.y > hi) continue;
      const share = covered(h.segs, textL - 6, textR + 6) / (textW + 12);
      if (share < 0.6) continue;
      const score = share - Math.abs(h.y - fallback) / 1000;
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    chosen.push(best);
    if (best) {
      ys.push(best.y);
      continue;
    }
    // No rule: the edge of a band behind the row above or below.
    const above = b > 0 ? bandsOf(b - 1).map((f) => f.y1).filter((y) => y >= lo && y <= hi) : [];
    const below = b < R ? bandsOf(b).map((f) => f.y0).filter((y) => y >= lo && y <= hi) : [];
    const edges = [...above, ...below];
    ys.push(edges.length ? edges.reduce((a, c) => a + c, 0) / edges.length : fallback);
  }
  for (let b = 1; b <= R; b++) if (ys[b] <= ys[b - 1] + 1) ys[b] = ys[b - 1] + 1;

  // Column edges: where the text asks for them, then where rules and bands end.
  const xs: number[] = [lefts[0] - 3];
  const anchors: number[] = [];
  for (const h of chosen) if (h) for (const s of h.segs) anchors.push(s.x0, s.x1);
  for (let r = 0; r < R; r++) for (const f of bandsOf(r)) anchors.push(f.x0, f.x1);
  for (let c = 1; c < C; c++) {
    const lo = aligns[c - 1] === "right" ? rights[c - 1] + 3 : undefined;
    const hi = aligns[c] === "left" ? lefts[c] - 3 : undefined;
    let x = (rights[c - 1] + lefts[c]) / 2;
    if (lo !== undefined && hi !== undefined) x = (lo + hi) / 2;
    else if (lo !== undefined) x = lo;
    else if (hi !== undefined) x = hi;
    x = clamp(x, rights[c - 1] + 0.5, Math.max(rights[c - 1] + 0.5, lefts[c] - 0.5));
    const drawn = anchors.filter((a) => a > rights[c - 1] + 0.5 && a < lefts[c] - 0.5);
    if (drawn.length) {
      const mid = (rights[c - 1] + lefts[c]) / 2;
      x = drawn.reduce((best, a) => (Math.abs(a - mid) < Math.abs(best - mid) ? a : best));
    }
    xs.push(x);
  }
  // A last column cut to its text wraps as soon as Word sets the type a little wider.
  xs.push(rights[C - 1] + (aligns[C - 1] === "right" ? 3 : 14));
  // The painted extent of the table: the outer rules and bands, when they reach past the text.
  xs[0] = Math.min(xs[0], ...anchors.filter((a) => a < lefts[0] && a > lefts[0] - 40));
  xs[C] = Math.max(xs[C], ...anchors.filter((a) => a > rights[C - 1] && a < rights[C - 1] + 40));

  const cells: GridCell[] = [];
  for (let r = 0; r < R; r++) {
    const placed = new Map<number, Line>();
    block[r].forEach((line, k) => placed.set(maps[r][k], line));
    for (let c = 0; c < C; c++) {
      const line = placed.get(c);
      if (line) used.add(line);
      const cell: GridCell = {
        row: r,
        col: c,
        rowSpan: 1,
        colSpan: 1,
        x0: xs[c],
        y0: ys[r],
        x1: xs[c + 1],
        y1: ys[r + 1],
        lines: line ? [line] : [],
      };
      // A rule that runs along this cell's bottom (or its top, above the first row) is its border.
      const along = (h: Horizontal | null) => !!h && covered(h.segs, xs[c], xs[c + 1]) >= 0.6 * (xs[c + 1] - xs[c]);
      const bottom = along(chosen[r + 1]);
      const top = r === 0 && along(chosen[0]);
      if (bottom || top) cell.borders = { ...(top ? { top: true } : {}), ...(bottom ? { bottom: true } : {}) };
      cells.push(cell);
    }
  }
  return {
    x0: xs[0],
    y0: ys[0],
    x1: xs[C],
    y1: ys[R],
    xs,
    ys,
    cells,
    borders: false,
    borderColor: commonColor(chosen.flatMap((h) => (h ? [h] : []))),
  };
}
