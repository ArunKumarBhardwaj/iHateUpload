import {
  lineFromFrags,
  lineText,
  matchMarker,
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
};

const TOL = 2.5;

type HLine = { y: number; x0: number; x1: number };
type VLine = { x: number; y0: number; y1: number };

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
    if (h <= 1.5 && w >= 6) hs.push({ y: (r.y0 + r.y1) / 2, x0: r.x0, x1: r.x1 });
    else if (w <= 1.5 && h >= 6) vs.push({ x: (r.x0 + r.x1) / 2, y0: r.y0, y1: r.y1 });
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
    });
  }
  return { tables, rest };
}

const wordsIn = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Conservative: three or more rows that each split into the same number of
 * short pieces, lined up on a left, right, or centre edge.
 */
export function detectBorderlessTables(lines: Line[]): { tables: TableEl[]; rest: Line[] } {
  const byRow = new Map<number, Line[]>();
  for (const line of lines) (byRow.get(line.row) ?? byRow.set(line.row, []).get(line.row)!).push(line);
  const rows = [...byRow.values()]
    .map((r) => r.sort((a, b) => a.x0 - b.x0))
    .sort((a, b) => a[0].baseline - b[0].baseline);

  const tables: TableEl[] = [];
  const used = new Set<Line>();
  const candidate = (row: Line[]) => row.length >= 2 && row.length <= 8;

  const alignedColumns = (block: Line[][]): boolean => {
    const n = block[0].length;
    for (let c = 0; c < n; c++) {
      const size = block[0][c].size;
      const tol = Math.max(4, size * 0.4);
      const ok = (get: (l: Line) => number) => {
        const values = block.map((row) => get(row[c]));
        const hits = values.filter((v) => values.filter((w) => Math.abs(w - v) <= tol).length >= block.length * 0.75);
        return hits.length >= block.length * 0.75;
      };
      if (!ok((l) => l.x0) && !ok((l) => l.x1) && !ok((l) => (l.x0 + l.x1) / 2)) return false;
    }
    // Columns must not run into each other.
    for (const row of block) {
      for (let c = 1; c < n; c++) if (row[c].x0 <= row[c - 1].x1) return false;
    }
    return true;
  };

  const shortCells = (block: Line[][]) => {
    const counts = block.flat().map((l) => wordsIn(lineText(l)));
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    return Math.max(...counts) <= 8 && mean <= 5;
  };

  const notList = (block: Line[][]) =>
    !block.every((row) => matchMarker(lineText(row[0])) !== null);

  const valid = (block: Line[][]) =>
    block.length >= 3 && alignedColumns(block) && shortCells(block) && notList(block);

  let i = 0;
  while (i < rows.length) {
    if (!candidate(rows[i])) {
      i++;
      continue;
    }
    let j = i;
    while (
      j + 1 < rows.length &&
      rows[j + 1].length === rows[i].length &&
      rows[j + 1][0].baseline - rows[j][0].baseline <= rows[j][0].size * 2.4 &&
      rows[j + 1][0].baseline - rows[j][0].baseline >= rows[j][0].size * 0.6
    ) {
      j++;
    }
    let from = i;
    let to = j;
    let block = rows.slice(from, to + 1);
    if (!valid(block) && block.length > 3) {
      // A heading row or a trailing total can be the odd one out.
      if (valid(rows.slice(from + 1, to + 1))) from++;
      else if (valid(rows.slice(from, to))) to--;
      block = rows.slice(from, to + 1);
    }
    if (valid(block)) {
      const n = block[0].length;
      const lefts = Array.from({ length: n }, (_, c) => Math.min(...block.map((r) => r[c].x0)));
      const rights = Array.from({ length: n }, (_, c) => Math.max(...block.map((r) => r[c].x1)));
      const xs = lefts.map((x, c) => (c === 0 ? x : Math.min(x, (rights[c - 1] + x) / 2)));
      xs.push(rights[n - 1] + 4);
      const ys = [block[0][0].top - 2, ...block.map((r) => r[0].bottom + 2)];
      const cells: GridCell[] = [];
      block.forEach((row, r) =>
        row.forEach((line, c) => {
          used.add(line);
          line.colL = lefts[c];
          line.colR = Math.max(rights[c], lefts[c] + 1);
          cells.push({
            row: r,
            col: c,
            rowSpan: 1,
            colSpan: 1,
            x0: xs[c],
            y0: ys[r],
            x1: xs[c + 1],
            y1: ys[r + 1],
            lines: [line],
          });
        }),
      );
      tables.push({
        x0: xs[0],
        y0: ys[0],
        x1: xs[n],
        y1: ys[ys.length - 1],
        xs,
        ys,
        cells,
        borders: false,
      });
    }
    i = Math.max(j + 1, i + 1);
  }
  return { tables, rest: lines.filter((l) => !used.has(l)) };
}
