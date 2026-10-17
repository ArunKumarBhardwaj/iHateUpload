/** What the person can change in the preview. Pure functions on the table grids, then a rebuild. */
import type { ColType } from "./cells";
import { render, typeGrid, type BuildResult, type ColumnInfo, type Prepared } from "./convert";
import type { Grid } from "./grid";
import { writeXlsx } from "./xlsx-writer";

/** Merged cells make row and column numbers mean different things, so editing the shape flattens them. */
function unmerge(grid: Grid) {
  for (const row of grid.rows) {
    for (const cell of row) {
      cell.rowSpan = 1;
      cell.colSpan = 1;
      cell.covered = false;
    }
  }
}

export function setCell(grid: Grid, r: number, c: number, text: string) {
  const cell = grid.rows[r]?.[c];
  if (cell) cell.text = text;
}

export function deleteRow(grid: Grid, r: number) {
  if (r < 0 || r >= grid.rows.length) return;
  unmerge(grid);
  grid.rows.splice(r, 1);
  if (grid.headerRows !== undefined && r < grid.headerRows) grid.headerRows--;
}

export function deleteColumn(grid: Grid, c: number) {
  if (c < 0 || c >= grid.xs.length - 1) return;
  unmerge(grid);
  for (const row of grid.rows) row.splice(c, 1);
  // The boundary to the left of a column goes, or the last one for the final column.
  grid.xs.splice(c === grid.xs.length - 2 ? c + 1 : c, 1);
  grid.colTypes?.splice(c, 1);
}

export function renameTable(grid: Grid, name: string) {
  grid.name = name;
}

export function setIncluded(grid: Grid, included: boolean) {
  grid.skip = !included;
}

export function setHeaderRows(grid: Grid, n: number) {
  grid.headerRows = Math.max(0, Math.min(n, grid.rows.length));
}

export function setColumnType(grid: Grid, c: number, type: ColType) {
  const cols = grid.xs.length - 1;
  grid.colTypes ??= Array.from({ length: cols }, () => "auto" as ColType);
  grid.colTypes[c] = type;
}

export function createEditor(prep: Prepared) {
  const typedOn = () => prep.options.typed !== false;
  return {
    prep,
    tables: () => prep.grids,
    /** What each column came out as, and how many cells did not fit. */
    columns: (grid: Grid): ColumnInfo[] => typeGrid(grid, typedOn()).info,
    headerRows: (grid: Grid) => typeGrid(grid, typedOn()).headers,
    /** Cells that could not be typed, over every table that is going into the file. */
    warnings: () =>
      prep.grids.filter((g) => !g.skip).reduce((n, g) => n + typeGrid(g, typedOn()).info.reduce((a, c) => a + c.warnings, 0), 0),
    async build(): Promise<BuildResult & { bytes: Uint8Array }> {
      const built = render(prep);
      return { ...built, bytes: await writeXlsx(built.book) };
    },
  };
}

export type ExcelEditor = ReturnType<typeof createEditor>;
