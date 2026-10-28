/** Excel workbook -> grids, one per visible sheet, using each cell's displayed (number formatted) text and formatting. */
import JSZip from "jszip";
import type { CellObject, WorkSheet } from "xlsx";

import type { Family } from "../word-to-pdf/model";
import { applyConditional, type CellValue } from "./conditional";
import { columnPt } from "./excel-layout";
import { readWorkbookStyles, type CellStyle, type PageSetup, type SheetStyles } from "./excel-styles";
import { krutiToUnicode } from "./krutidev";
import { toUnicode } from "./legacy-fonts";
import { applyOdsGeometry, readOds } from "./ods-styles";
import { readXlsStyles } from "./xls-styles";
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

const FORMAT_COLORS: Record<string, string> = {
  black: "000000",
  blue: "0000FF",
  cyan: "00FFFF",
  green: "00FF00",
  magenta: "FF00FF",
  red: "FF0000",
  white: "FFFFFF",
  yellow: "FFFF00",
};

/** The colour a number format's section gives a value, as in "#,##0;[Red]-#,##0". */
export function formatColor(fmt: string | undefined, v: unknown): string | undefined {
  if (!fmt || !fmt.includes("[")) return undefined;
  // split into sections at semicolons outside quotes and brackets
  const sections: string[] = [""];
  let quoted = false;
  let bracket = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === "\\" && !quoted) {
      sections[sections.length - 1] += ch + (fmt[++i] ?? "");
      continue;
    }
    if (ch === '"' && !bracket) quoted = !quoted;
    else if (ch === "[" && !quoted) bracket = true;
    else if (ch === "]" && !quoted) bracket = false;
    else if (ch === ";" && !quoted && !bracket) {
      sections.push("");
      continue;
    }
    sections[sections.length - 1] += ch;
  }
  // conditional sections ([>=100]) pick by condition; leave those to the plain text
  if (sections.some((s) => /\[[<>=]/.test(s))) return undefined;
  let s: string;
  if (typeof v !== "number") s = sections[3] ?? (sections.length === 1 ? sections[0] : "");
  else if (v > 0 || sections.length === 1) s = sections[0];
  else if (v < 0) s = sections[1] ?? sections[0];
  else s = sections[2] ?? sections[0];
  const m = /\[(black|blue|cyan|green|magenta|red|white|yellow|color\s*(\d+))\]/i.exec(s);
  if (!m) return undefined;
  if (m[2]) return COLOR_INDEX[Number(m[2]) - 1];
  return FORMAT_COLORS[m[1].toLowerCase()];
}

/** The first colours of Excel's default palette, as [Color n] uses them. */
const COLOR_INDEX = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF", "800000", "008000", "000080", "808000", "800080", "008080", "C0C0C0", "808080"];

/**
 * The number format asks for Indian digit grouping (12,34,567): it is written that way, or it is a
 * rupee or en-IN (-4009) format, which Excel groups by lakh and crore on Indian PCs.
 */
export function indianGrouping(fmt: string | undefined): boolean {
  if (!fmt || !fmt.includes(",")) return false;
  return /#,##,##0|0,00,000/.test(fmt) || /₹|\bRs\.?|-4009\]|\[\$INR/i.test(fmt);
}

/** Regroup the first grouped number in formatted text by lakh and crore: 4,567,890.50 -> 45,67,890.50. */
export function lakhGroup(text: string): string {
  return text.replace(/\d{1,3}(?:,\d{3})+|\d{4,}(?=[.,]\d|\D|$)/, (m) => {
    const digits = m.replace(/,/g, "");
    if (digits.length <= 3) return m;
    const head = digits.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ",");
    return `${head},${digits.slice(-3)}`;
  });
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
  // merged areas print in full, even past the last cell with a value
  for (const m of sheet["!merges"] ?? []) {
    used.e.r = Math.max(used.e.r, m.e.r);
    used.e.c = Math.max(used.e.c, m.e.c);
  }
  const range = names.area ?? used;
  const cols = sheet["!cols"] ?? [];
  // row heights and hidden rows: the file's own record of them where read, else SheetJS's
  const rowsMeta: { hpt?: number; hidden?: boolean }[] = [...(sheet["!rows"] ?? [])];
  for (const [r, info] of sheetStyles?.rows ?? []) {
    rowsMeta[r] = { hpt: info.hpt ?? rowsMeta[r]?.hpt, hidden: info.hidden || !!rowsMeta[r]?.hidden };
  }
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
      const runs = sheetStyles?.runs.get(addr);
      let shown = runs ? runs.map((r) => r.text).join("") : displayText(XLSX, cell);
      // .ods gives no format code, only the text: a rupee amount there groups by lakh too
      const rupees = typeof cell.z === "string" ? indianGrouping(cell.z) : /₹|\bRs\.?/.test(shown);
      if (cell.t === "n" && !runs && rupees && /\d,\d{3}/.test(shown)) shown = lakhGroup(shown);
      if (runs) out.runs = runs;
      else if (style?.kruti && cell.t === "s") shown = krutiToUnicode(shown);
      else if (style?.legacy && cell.t === "s") shown = toUnicode(style.legacy, shown);
      out.text = shown.trim();
      if (out.text && shown !== out.text) out.raw = shown;
      out.num = cell.t === "n" || (cell.t === "d" ? false : looksNumeric(out.text) && cell.t !== "s");
      if (cell.t === "b" || cell.t === "e") out.centred = true;
      if (cell.t === "n" && (typeof cell.z !== "string" || cell.z === "General")) out.general = true;
      const color = formatColor(typeof cell.z === "string" ? cell.z : undefined, cell.v);
      if (color) out.fmtColor = color;
      return out;
    }),
  );

  // conditional formatting, from the cells' values
  if (sheetStyles?.conditional?.length) {
    const get = (r: number, c: number): CellValue => {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })] as CellObject | undefined;
      if (!cell || cell.v === undefined || cell.v === null) return undefined;
      if (cell.t === "e") return { error: String(cell.w ?? "#N/A") };
      if (cell.t === "b") return !!cell.v;
      if (cell.t === "n") return Number(cell.v);
      return String(cell.v);
    };
    const at = keepRows.flatMap((r) => keepCols.map((c) => ({ r, c })));
    const cf = applyConditional(sheetStyles.conditional, get, at, new Date(), { r1: used.e.r, c1: used.e.c });
    keepRows.forEach((r, ri) =>
      keepCols.forEach((c, ci) => {
        const hit = cf.get(`${r},${c}`);
        if (!hit) return;
        const cell = rows[ri][ci];
        const { border, ...look } = hit.style;
        cell.style = { ...cell.style, ...look, border: border ? { ...cell.style?.border, ...border } : cell.style?.border };
        if (look.fill || look.color || look.bold || look.italic) styled = true;
        if (hit.bar) cell.bar = hit.bar;
      }),
    );
  }

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
    // Excel draws a merged cell's outline from the cells along each side, not just the first one
    const side = (cells: GridCell[], key: "top" | "right" | "bottom" | "left") => cells.map((g) => g.style?.border?.[key]).find(Boolean);
    const last = rs[rs.length - 1];
    const right = cs[cs.length - 1];
    const border: CellStyle["border"] = {
      top: side(cs.map((c) => rows[r0][c]), "top"),
      bottom: side(cs.map((c) => rows[last][c]), "bottom"),
      left: side(rs.map((r) => rows[r][c0]), "left"),
      right: side(rs.map((r) => rows[r][right]), "right"),
    };
    if (border.top || border.bottom || border.left || border.right) head.style = { ...head.style, border };
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
  const defH = setup.defaultRowHeight ?? 15;
  const colWidthOf = (c: number) => (cols[c]?.hidden ? 0 : (cols[c]?.width ?? defW));
  const rowHeightOf = (r: number) => (rowsMeta[r]?.hidden ? 0 : (rowsMeta[r]?.hpt ?? defH));
  // pictures, as rectangles in unscaled points from the print area's top-left corner
  const xOf = (col: number, dx: number) => {
    let x = 0;
    if (col >= range.s.c) for (let c = range.s.c; c < col; c++) x += columnPt(colWidthOf(c));
    else for (let c = col; c < range.s.c; c++) x -= columnPt(colWidthOf(c));
    return x + (colWidthOf(col) ? dx : 0);
  };
  const yOf = (row: number, dy: number) => {
    let y = 0;
    if (row >= range.s.r) for (let r = range.s.r; r < row; r++) y += rowHeightOf(r);
    else for (let r = row; r < range.s.r; r++) y -= rowHeightOf(r);
    return y + (rowHeightOf(row) ? dy : 0);
  };
  const pictures = (sheetStyles?.pictures ?? []).flatMap((p) => {
    const x = xOf(p.from.col, p.from.dx);
    const y = yOf(p.from.row, p.from.dy);
    const w = p.to ? xOf(p.to.col, p.to.dx) - x : (p.size?.w ?? 0);
    const h = p.to ? yOf(p.to.row, p.to.dy) - y : (p.size?.h ?? 0);
    return w > 0.5 && h > 0.5 ? [{ data: p.data, mime: p.mime, x, y, w, h }] : [];
  });
  grid.sheet = {
    colWidths: keepCols.slice(0, width).map((c) => cols[c]?.width ?? defW),
    rowHeights: keepRows.slice(0, trimmed.length).map((r) => rowsMeta[r]?.hpt ?? defH),
    // rows whose height wasn't set by hand fit their content, as Excel does
    autoRows: keepRows.slice(0, trimmed.length).map((r) => !sheetStyles?.rows?.get(r)?.custom),
    pictures,
    setup,
    titleRows: names.titles
      ? keepRows.slice(0, trimmed.length).flatMap((r, i) => ((names.titles as [number, number])[0] <= r && r <= (names.titles as [number, number])[1] ? [i] : []))
      : [],
    baseSize,
    baseFamily,
    // a break before a hidden or trimmed row moves to the next row that prints
    breakRows: [...new Set((setup.rowBreaks ?? []).map((b) => keepRows.findIndex((r) => r >= b)).filter((i) => i > 0 && i < trimmed.length))],
    breakCols: [...new Set((setup.colBreaks ?? []).map((b) => keepCols.findIndex((c) => c >= b)).filter((i) => i > 0 && i < width))],
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

/**
 * SheetJS counts a run of covered (merged-away) cells in .ods as one column, which shifts the rest of
 * the row left: every merge LibreOffice writes does this. Spell the runs out before it reads them.
 */
async function expandOdsCoveredCells(data: ArrayBuffer | Uint8Array): Promise<ArrayBuffer | Uint8Array> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return data;
  }
  const mime = await zip.file("mimetype")?.async("string");
  const content = zip.file("content.xml");
  if (!mime?.includes("opendocument.spreadsheet") || !content) return data;
  const xml = await content.async("string");
  // runs this long are the empty tail of a row; leave them as they are
  const fixed = xml.replace(/<table:covered-table-cell\b([^>]*?)\s*table:number-columns-repeated="(\d+)"([^>]*?)\/>/g, (m, a: string, n: string, b: string) =>
    Number(n) > 1024 ? m : `<table:covered-table-cell${a}${b}/>`.repeat(Number(n)),
  );
  if (fixed === xml) return data;
  zip.file("content.xml", fixed);
  return zip.generateAsync({ type: "uint8array" });
}

export async function workbookGrids(data: ArrayBuffer | Uint8Array): Promise<{ sheets: SheetGrid[]; all: string[] }> {
  const XLSX = await import("xlsx");
  // cellStyles is what makes SheetJS read column widths, hidden columns and hidden rows
  const wb = XLSX.read(await expandOdsCoveredCells(data), { type: "array", cellDates: false, cellStyles: true, cellNF: true });
  // OpenDocument (.ods), whose widths and heights SheetJS doesn't read; else .xlsx/.xlsm; else Excel 97-2003 .xls
  const ods = await readOds(data);
  if (ods) for (const [name, geo] of ods.geometry) if (wb.Sheets[name]) applyOdsGeometry(wb.Sheets[name], geo);
  const styles = ods?.styles ?? (await readWorkbookStyles(data)) ?? (await readXlsStyles(data));
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
