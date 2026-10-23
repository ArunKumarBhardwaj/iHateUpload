/** Excel workbook -> grids, one per visible sheet, using each cell's displayed (number formatted) text and formatting. */
import type { CellObject, WorkSheet } from "xlsx";

import type { Family } from "../word-to-pdf/model";
import { readWorkbookStyles, type PageSetup, type SheetStyles } from "./excel-styles";
import { looksNumeric, type Grid, type GridCell } from "./tables";

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

/**
 * SheetJS rejects formats with bare non-ASCII literals (e.g. `₹#,##0.00`) that Excel accepts.
 * Quote those characters and format again.
 */
export function quoteLiterals(fmt: string): string {
  let out = "";
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === "\\" && !quoted) {
      out += ch + (fmt[++i] ?? "");
      continue;
    }
    if (ch === '"' && !bracket) quoted = !quoted;
    else if (ch === "[" && !quoted) bracket = true;
    else if (ch === "]" && !quoted) bracket = false;
    else if (!quoted && !bracket && ch.charCodeAt(0) > 127) {
      out += `"${ch}"`;
      continue;
    }
    out += ch;
  }
  return out;
}

function displayText(XLSX: XlsxModule, cell: CellObject): string {
  if (cell.w !== undefined) return String(cell.w);
  if (cell.t === "n" && typeof cell.z === "string" && typeof cell.v === "number") {
    try {
      return XLSX.SSF.format(quoteLiterals(cell.z), cell.v);
    } catch {
      // fall through to the raw value
    }
  }
  return String(cell.v);
}

type Range = { s: { r: number; c: number }; e: { r: number; c: number } };

/** A sheet's print area and print-title rows, from the workbook's defined names. */
function printNames(XLSX: XlsxModule, wb: import("xlsx").WorkBook, index: number): { area?: Range; titles?: [number, number] } {
  const out: { area?: Range; titles?: [number, number] } = {};
  for (const n of wb.Workbook?.Names ?? []) {
    if (n.Sheet !== index || !n.Ref) continue;
    // "'Sheet 1'!$B$1:$E$37" or "Sheet1!$A$1:$D$9,Sheet1!$F$1:$G$9": the first area is used
    const first = n.Ref.split(",")[0].replace(/^.*!/, "").replace(/\$/g, "");
    if (n.Name === "_xlnm.Print_Area") {
      try {
        const r = XLSX.utils.decode_range(first);
        if (r.e.r >= r.s.r && r.e.c >= r.s.c && r.s.r >= 0 && r.s.c >= 0) out.area = r;
      } catch {
        // an unreadable name prints the whole sheet
      }
    } else if (n.Name === "_xlnm.Print_Titles") {
      const rows = n.Ref.split(",").map((p) => p.replace(/^.*!/, "").replace(/\$/g, "")).find((p) => /^\d+:\d+$/.test(p));
      if (rows) {
        const [a, b] = rows.split(":").map((v) => Number(v) - 1);
        out.titles = [a, b];
      }
    }
  }
  return out;
}

function sheetToGrid(
  XLSX: XlsxModule,
  sheet: WorkSheet,
  sheetStyles: SheetStyles | undefined,
  baseSize: number,
  baseFamily: Family,
  names: { area?: Range; titles?: [number, number] } = {},
): Grid {
  const styles = sheetStyles?.cells;
  const ref = sheet["!ref"];
  if (!ref) return { rows: [], header: false };
  const used = XLSX.utils.decode_range(ref);
  const range = names.area ?? used;
  const cols = sheet["!cols"] ?? [];
  const rowsMeta = sheet["!rows"] ?? [];
  const keepCols: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) if (!cols[c]?.hidden) keepCols.push(c);
  const keepRows: number[] = [];
  for (let r = range.s.r; r <= range.e.r; r++) if (!rowsMeta[r]?.hidden) keepRows.push(r);
  const colAt = new Map(keepCols.map((c, i) => [c, i]));
  const rowAt = new Map(keepRows.map((r, i) => [r, i]));

  let styled = false;
  const rows: GridCell[][] = keepRows.map((r) =>
    keepCols.map((c) => {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr] as CellObject | undefined;
      const style = styles?.get(addr);
      if (style && (style.fill || style.bold || style.italic || style.color || style.size || style.border)) styled = true;
      const out: GridCell = { text: "", num: false };
      if (style) out.style = style;
      if (!cell || cell.v === undefined || cell.v === null) return out;
      const shown = displayText(XLSX, cell);
      out.text = shown.trim();
      if (out.text && shown !== out.text) out.raw = shown;
      out.num = cell.t === "n" || (cell.t === "d" ? false : looksNumeric(out.text) && cell.t !== "s");
      return out;
    }),
  );

  // merged cells: the top-left cell spans the visible rows and columns of the range
  let mergeRight = 0;
  let mergeBottom = 0;
  for (const m of sheet["!merges"] ?? []) {
    const r0 = rowAt.get(m.s.r);
    const c0 = colAt.get(m.s.c);
    if (r0 === undefined || c0 === undefined) continue;
    const rs = keepRows.filter((r) => r >= m.s.r && r <= m.e.r).map((r) => rowAt.get(r) as number);
    const cs = keepCols.filter((c) => c >= m.s.c && c <= m.e.c).map((c) => colAt.get(c) as number);
    if (rs.length * cs.length < 2) continue;
    const head = rows[r0][c0];
    head.colSpan = cs.length;
    head.rowSpan = rs.length;
    for (const r of rs) for (const c of cs) if (r !== r0 || c !== c0) rows[r][c].covered = true;
    if (head.text) {
      mergeRight = Math.max(mergeRight, c0 + cs.length);
      mergeBottom = Math.max(mergeBottom, r0 + rs.length);
    }
  }

  // trim empty rows at the end and empty columns at the right (a merged cell with text counts as
  // filled, and so does a bordered one, as Excel prints those). A print area is printed as it is.
  const filled = (c: GridCell) => !!c.text || !!c.style?.fill || !!c.style?.border;
  let width = names.area ? keepCols.length : mergeRight;
  if (!names.area) {
    while (rows.length > mergeBottom && rows[rows.length - 1].every((c) => !filled(c))) rows.pop();
    for (const r of rows) for (let c = r.length - 1; c >= width; c--) if (filled(r[c])) width = Math.max(width, c + 1);
  }
  const trimmed = rows.map((r) =>
    r.slice(0, width).map((cell, c) => (cell.colSpan && c + cell.colSpan > width ? { ...cell, colSpan: width - c } : cell)),
  );
  // a merge cut off by the trimming must not run past the last row
  trimmed.forEach((r, ri) =>
    r.forEach((cell) => {
      if (cell.rowSpan && ri + cell.rowSpan > trimmed.length) cell.rowSpan = trimmed.length - ri;
    }),
  );

  // widths only count cells that sit in one column; a merged title must not widen column A
  const textLen = (c: number) =>
    Math.max(0, ...trimmed.map((r) => (r[c] && !r[c].covered && (r[c].colSpan ?? 1) === 1 ? r[c].text.length : 0)));
  const colChars = keepCols.slice(0, width).map((c) => {
    const col = cols[c];
    return col?.wch ?? (col?.wpx ? col.wpx / 7 : col?.width);
  });
  const hasWidths = colChars.some((w) => w !== undefined);
  const grid: Grid = { rows: trimmed, header: trimmed.length > 1, styled };
  // the sheet as Excel prints it: widths in Excel's units, row heights in points, page setup
  const setup: PageSetup = sheetStyles?.setup ?? {};
  const defW = setup.defaultColWidth ?? 9.140625;
  grid.sheet = {
    colWidths: keepCols.slice(0, width).map((c) => cols[c]?.width ?? defW),
    rowHeights: keepRows.slice(0, trimmed.length).map((r) => rowsMeta[r]?.hpt ?? setup.defaultRowHeight ?? 15),
    setup,
    titleRows: names.titles
      ? keepRows.slice(0, trimmed.length).flatMap((r, i) => ((names.titles as [number, number])[0] <= r && r <= (names.titles as [number, number])[1] ? [i] : []))
      : [],
    baseSize,
    baseFamily,
  };
  if (!hasWidths) {
    // widest content per column bounds columns the file gave no width for
    grid.colChars = Array.from({ length: width }, (_, c) => Math.min(40, Math.max(6, textLen(c) * 1.05)));
  } else {
    // a sheet width of 8.43 is the default; widen to the content (up to 1.6x) when it would clip badly
    grid.colChars = colChars.map((w, c) => {
      const need = Math.min(48, textLen(c));
      return Math.max(w ?? 8.43, Math.min(need * 1.05, (w ?? 8.43) * 1.6));
    });
  }
  if (styled) grid.baseSize = baseSize;
  return grid;
}

export async function workbookGrids(data: ArrayBuffer | Uint8Array): Promise<{ sheets: SheetGrid[]; all: string[] }> {
  const XLSX = await import("xlsx");
  // cellStyles is what makes SheetJS read column widths, hidden columns and hidden rows
  const wb = XLSX.read(data, { type: "array", cellDates: false, cellStyles: true, cellNF: true });
  const styles = await readWorkbookStyles(data);
  const all = visibleSheetNames(wb);
  return {
    all,
    sheets: all.map((name) => ({
      name,
      grid: sheetToGrid(XLSX, wb.Sheets[name], styles?.sheets.get(name), styles?.baseSize ?? 11, styles?.baseFamily ?? "sans", printNames(XLSX, wb, wb.SheetNames.indexOf(name))),
    })),
  };
}

/** Sheet names without parsing every cell, for the sheet picker. */
export async function readSheetNames(data: ArrayBuffer): Promise<string[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(data, { type: "array", bookSheets: true });
  return visibleSheetNames(wb);
}
