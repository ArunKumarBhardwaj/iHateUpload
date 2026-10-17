/**
 * Page layout to table grids. Reuses the table and line detection that PDF to Word uses, then
 * joins tables that run across pages and names each one from the heading above it.
 */
import { applyDecorations } from "../pdf-to-word/decorations";
import { buildLines, lineText, type Fill, type Line, type PageInput } from "../pdf-to-word/lines";
import { detectBorderlessTables, detectRuledTables, type GridCell, type TableEl } from "../pdf-to-word/tables";

export type Edges = { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };

export type GridCellData = {
  text: string;
  bold: boolean;
  /** Hex, no hash. */
  fill?: string;
  borders: Edges;
  /** Only on the cell that holds the text. */
  rowSpan: number;
  colSpan: number;
  /** True for the cells a merged cell covers. */
  covered?: boolean;
};

export type Grid = {
  page: number;
  y0: number;
  y1: number;
  xs: number[];
  rows: GridCellData[][];
  bordered: boolean;
  borderColor?: string;
  heading?: string;
  /** Typical height of one row, in points. */
  rowPitch: number;
};

export type TextRow = { page: number; y: number; text: string };

export type PageParts = {
  page: number;
  height: number;
  grids: Grid[];
  /** Lines the tables left over, kept for orphan rows at the top of the next page. */
  rest: Line[];
  /** Running headers, footers and page numbers among the loose lines. */
  furniture: Set<Line>;
};

const median = (values: number[]) => {
  const s = [...values].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

const normalizeSpace = (s: string) => s.replace(/\s+/g, " ").trim();

/** Repeated page furniture: running headers, footers and page numbers. Digits do not count. */
function furnitureKeys(pages: Line[][], heights: number[]): Set<string>[] {
  const seen = new Map<string, Set<number>>();
  const keyOf = (l: Line) => normalizeSpace(lineText(l)).replace(/\d+/g, "#").toLowerCase();
  const band = (l: Line, h: number) => l.baseline < h * 0.1 || l.baseline > h * 0.9;
  pages.forEach((lines, p) => {
    for (const l of lines) {
      if (!band(l, heights[p])) continue;
      const k = keyOf(l);
      (seen.get(k) ?? seen.set(k, new Set()).get(k)!).add(p);
    }
  });
  const need = Math.max(2, Math.ceil(pages.length * 0.5));
  return pages.map((lines, p) => {
    const out = new Set<string>();
    for (const l of lines) {
      if (!band(l, heights[p])) continue;
      const k = keyOf(l);
      if ((seen.get(k)?.size ?? 0) >= need) out.add(k);
    }
    return out;
  });
}

function shadeOf(cell: GridCell, fills: Fill[]): string | undefined {
  const area = (cell.x1 - cell.x0) * (cell.y1 - cell.y0);
  if (!(area > 0)) return undefined;
  for (let i = fills.length - 1; i >= 0; i--) {
    const f = fills[i];
    const w = Math.min(f.x1, cell.x1) - Math.max(f.x0, cell.x0);
    const h = Math.min(f.y1, cell.y1) - Math.max(f.y0, cell.y0);
    if (w > 0 && h > 0 && (w * h) / area >= 0.7) return f.color.toUpperCase();
  }
  return undefined;
}

/** The text of a set of lines: one visual row after another, pieces on a row side by side. */
function joinLines(lines: Line[]): string {
  const sorted = [...lines].sort((a, b) => a.baseline - b.baseline || a.x0 - b.x0);
  return normalizeSpace(sorted.map((l) => lineText(l)).join(" "));
}

const allBold = (lines: Line[]) =>
  lines.length > 0 && lines.every((l) => l.frags.every((f) => f.bold || !f.text.trim()));

function gridOf(table: TableEl, page: number, fills: Fill[]): Grid {
  const rows = table.ys.length - 1;
  const cols = table.xs.length - 1;
  const data: GridCellData[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ text: "", bold: false, borders: {}, rowSpan: 1, colSpan: 1 })),
  );
  for (const cell of table.cells) {
    const fill = shadeOf(cell, fills);
    const borders: Edges = table.borders ? { top: true, bottom: true, left: true, right: true } : (cell.borders ?? {});
    for (let r = cell.row; r < Math.min(rows, cell.row + cell.rowSpan); r++) {
      for (let c = cell.col; c < Math.min(cols, cell.col + cell.colSpan); c++) {
        const anchor = r === cell.row && c === cell.col;
        data[r][c] = {
          text: anchor ? joinLines(cell.lines) : "",
          bold: anchor && allBold(cell.lines),
          fill,
          borders,
          rowSpan: anchor ? cell.rowSpan : 1,
          colSpan: anchor ? cell.colSpan : 1,
          covered: !anchor,
        };
      }
    }
  }
  return {
    page,
    y0: table.y0,
    y1: table.y1,
    xs: table.xs,
    rows: data.filter((row) => row.some((c) => c.text || c.fill || c.covered)),
    bordered: table.borders,
    borderColor: table.borderColor,
    rowPitch: (table.y1 - table.y0) / Math.max(1, rows),
  };
}

const headingOf = (lines: Line[], grid: Grid, bodySize: number, floor: number): string | undefined => {
  const above = lines
    .filter((l) => l.bottom <= grid.y0 + 1 && l.top >= floor - 1)
    .sort((a, b) => b.baseline - a.baseline || b.size - a.size);
  for (const l of above) {
    const text = normalizeSpace(lineText(l));
    if (text.length < 3 || text.length > 60 || !/[A-Za-z]/.test(text)) continue;
    if ((l.size >= bodySize * 1.15 || allBold([l])) && !/:\s*\S/.test(text)) return text.replace(/[:.]+$/, "");
  }
  return undefined;
};

/** Merge neighbours on one page that are the same table split by a small gap. */
function joinNeighbours(grids: Grid[]): Grid[] {
  const out: Grid[] = [];
  for (const g of grids) {
    const last = out[out.length - 1];
    if (
      last &&
      !last.bordered &&
      !g.bordered &&
      g.xs.length === last.xs.length &&
      g.y0 - last.y1 <= Math.max(last.rowPitch, g.rowPitch) * 1.6 &&
      g.xs.every((x, i) => Math.abs(x - last.xs[i]) <= 10)
    ) {
      last.rows.push(...g.rows);
      last.y1 = g.y1;
      continue;
    }
    out.push(g);
  }
  return out;
}

export function readPages(inputs: PageInput[], pageNumbers: number[]): PageParts[] {
  const lineSets = inputs.map((p) => buildLines(p.items));
  const furniture = furnitureKeys(lineSets, inputs.map((p) => p.height));
  return inputs.map((input, index) => {
    const all = lineSets[index];
    const band = (l: Line) => l.baseline < input.height * 0.1 || l.baseline > input.height * 0.9;
    const lines = all;
    const isFurniture = (l: Line) => band(l) && furniture[index].has(normalizeSpace(lineText(l)).replace(/\d+/g, "#").toLowerCase());
    const dec = applyDecorations(lines, input.rules, input.fills);
    const ruled = detectRuledTables(lines, dec.rules);
    const gridRules = dec.rules.filter(
      (r) => !ruled.tables.some((t) => r.x0 >= t.x0 - 3 && r.x1 <= t.x1 + 3 && r.y0 >= t.y0 - 3 && r.y1 <= t.y1 + 3),
    );
    const loose = detectBorderlessTables(ruled.rest, gridRules, input.fills ?? []);
    const tables = [...ruled.tables, ...loose.tables].sort((a, b) => a.y0 - b.y0);
    const page = pageNumbers[index];
    const bodySize = median(lines.map((l) => l.size));
    const grids = joinNeighbours(tables.map((t) => gridOf(t, page, input.fills ?? [])));
    let floor = 0;
    for (const g of grids) {
      g.heading = headingOf(loose.rest, g, bodySize, floor);
      floor = g.y1;
    }
    return { page, height: input.height, grids, rest: loose.rest, furniture: new Set(loose.rest.filter(isFurniture)) };
  });
}

const sameColumns = (a: Grid, b: Grid) => {
  if (a.xs.length !== b.xs.length) return false;
  const tol = a.bordered && b.bordered ? 4 : 14;
  return a.bordered === b.bordered && a.xs.every((x, i) => Math.abs(x - b.xs[i]) <= tol);
};

const rowKey = (row: GridCellData[]) => row.map((c) => c.text).join("\u0001");

/**
 * Rows at the top of a page that the detector left as loose text, but that sit in the previous
 * table's columns, one piece per column. Returns the rows and the lines they used.
 */
function orphanRows(grid: Grid, rest: Line[], height: number, furniture: Set<Line>): { rows: GridCellData[][]; used: Set<Line> } {
  const used = new Set<Line>();
  const rows: GridCellData[][] = [];
  const byRow = new Map<number, Line[]>();
  for (const l of rest) (byRow.get(l.row) ?? byRow.set(l.row, []).get(l.row)!).push(l);
  const ordered = [...byRow.values()].sort((a, b) => a[0].baseline - b[0].baseline);
  const cols = grid.xs.length - 1;
  for (const parts of ordered) {
    if (parts.every((l) => furniture.has(l))) continue;
    if (parts[0].baseline > height * 0.3 && rows.length === 0) break;
    const cells = Array.from({ length: cols }, () => [] as Line[]);
    let ok = parts.length >= 2;
    for (const l of parts) {
      const c = grid.xs.findIndex((x, i) => i < cols && l.x0 >= x - 3 && l.x1 <= grid.xs[i + 1] + 3);
      if (c < 0) {
        ok = false;
        break;
      }
      cells[c].push(l);
    }
    if (!ok) break;
    rows.push(
      cells.map((ls) => ({
        text: joinLines(ls),
        bold: allBold(ls),
        borders: {},
        rowSpan: 1,
        colSpan: 1,
      })),
    );
    for (const l of parts) used.add(l);
  }
  return { rows, used };
}

/** Loose text of a page, one entry per visual row. */
export function textRows(rest: Line[], page: number, furniture: Set<Line> = new Set()): TextRow[] {
  const rows = new Map<number, Line[]>();
  for (const l of rest) if (!furniture.has(l)) (rows.get(l.row) ?? rows.set(l.row, []).get(l.row)!).push(l);
  return [...rows.values()]
    .map((parts) => ({
      page,
      y: Math.min(...parts.map((l) => l.baseline)),
      text: normalizeSpace(parts.sort((a, b) => a.x0 - b.x0).map((l) => lineText(l)).join(" ")),
    }))
    .filter((r) => r.text)
    .sort((a, b) => a.y - b.y);
}

/** Tables in reading order, with the ones that run over several pages made into one. */
export function joinAcrossPages(parts: PageParts[]): { grids: Grid[]; pagesOf: Map<Grid, number[]> } {
  const out: Grid[] = [];
  const pagesOf = new Map<Grid, number[]>();
  let open: Grid | null = null;
  let openPage = -1;
  let openBottom = 0;
  let openHeight = 1;
  for (const part of parts) {
    let absorbedTo: number | null = null;
    if (open && part.page === openPage + 1 && openBottom >= openHeight * 0.65) {
      const lead = part.grids[0];
      if (lead && lead.y0 <= part.height * 0.3 && sameColumns(open, lead)) {
        const dropHeader =
          open.rows.length > 1 && rowKey(lead.rows[0]) === rowKey(open.rows[0]) && lead.rows[0].some((c) => c.text);
        open.rows.push(...(dropHeader ? lead.rows.slice(1) : lead.rows));
        pagesOf.get(open)!.push(part.page);
        part.grids.shift();
        absorbedTo = lead.y1;
      } else {
        const orphan = orphanRows(open, part.rest, part.height, part.furniture);
        if (orphan.rows.length) {
          open.rows.push(...orphan.rows);
          pagesOf.get(open)!.push(part.page);
          part.rest = part.rest.filter((l) => !orphan.used.has(l));
          absorbedTo = Math.max(...[...orphan.used].map((l) => l.bottom));
        }
      }
    }
    for (const g of part.grids) {
      out.push(g);
      pagesOf.set(g, [part.page]);
    }
    const last = part.grids[part.grids.length - 1];
    if (last) {
      open = last;
      openPage = part.page;
      openBottom = last.y1;
      openHeight = part.height;
    } else if (absorbedTo !== null) {
      openPage = part.page;
      openBottom = absorbedTo;
      openHeight = part.height;
    } else {
      open = null;
    }
  }
  return { grids: out, pagesOf };
}
