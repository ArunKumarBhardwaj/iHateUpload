/** Excel workbook -> grids, one per visible sheet, using each cell's displayed (number formatted) text. */
import type { WorkSheet } from "xlsx";

import { looksNumeric, type Grid } from "./tables";

export interface SheetGrid {
  name: string;
  grid: Grid;
}

type XlsxModule = typeof import("xlsx");

function isHidden(wb: import("xlsx").WorkBook, index: number): boolean {
  const h = wb.Workbook?.Sheets?.[index]?.Hidden;
  return !!h;
}

/** Names of the sheets a reader can see in Excel, in order. */
export function visibleSheetNames(wb: import("xlsx").WorkBook): string[] {
  return wb.SheetNames.filter((_, i) => !isHidden(wb, i));
}

function sheetToGrid(XLSX: XlsxModule, sheet: WorkSheet): Grid {
  const ref = sheet["!ref"];
  if (!ref) return { rows: [], header: false };
  const range = XLSX.utils.decode_range(ref);
  const cols = sheet["!cols"] ?? [];
  const rowsMeta = sheet["!rows"] ?? [];
  const keepCols: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) if (!cols[c]?.hidden) keepCols.push(c);
  const rows: Grid["rows"] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    if (rowsMeta[r]?.hidden) continue;
    rows.push(
      keepCols.map((c) => {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell || cell.v === undefined || cell.v === null) return { text: "", num: false };
        const text = String(cell.w ?? cell.v).trim();
        return { text, num: cell.t === "n" || (cell.t === "d" ? false : looksNumeric(text) && cell.t !== "s") };
      }),
    );
  }
  // trim empty rows at the end and empty columns at the right
  while (rows.length && rows[rows.length - 1].every((c) => !c.text)) rows.pop();
  let width = 0;
  for (const r of rows) for (let c = r.length - 1; c >= width; c--) if (r[c].text) width = Math.max(width, c + 1);
  const trimmed = rows.map((r) => r.slice(0, width));
  const colChars = keepCols.slice(0, width).map((c) => {
    const col = cols[c];
    return col?.wch ?? (col?.wpx ? col.wpx / 7 : col?.width);
  });
  const hasWidths = colChars.some((w) => w !== undefined);
  // widest content per column bounds columns the file gave no width for
  const grid: Grid = { rows: trimmed, header: trimmed.length > 1, colChars: hasWidths ? colChars : undefined };
  if (!hasWidths) {
    grid.colChars = Array.from({ length: width }, (_, c) =>
      Math.min(40, Math.max(6, ...trimmed.map((r) => (r[c]?.text.length ?? 0) * 1.05))),
    );
  } else {
    // a sheet width of 8.43 is the default; widen to the content up to 3x when it would clip badly
    grid.colChars = colChars.map((w, c) => {
      const need = Math.min(48, Math.max(0, ...trimmed.map((r) => Math.min(r[c]?.text.length ?? 0, 48))));
      return Math.max(w ?? 8.43, Math.min(need * 1.05, (w ?? 8.43) * 1.6));
    });
  }
  return grid;
}

export async function workbookGrids(data: ArrayBuffer | Uint8Array): Promise<{ sheets: SheetGrid[]; all: string[] }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array", cellDates: false, cellStyles: false });
  const all = visibleSheetNames(wb);
  return { all, sheets: all.map((name) => ({ name, grid: sheetToGrid(XLSX, wb.Sheets[name]) })) };
}

/** Sheet names without parsing every cell, for the sheet picker. */
export async function readSheetNames(data: ArrayBuffer): Promise<string[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array", bookSheets: true });
  return visibleSheetNames(wb);
}
