/** Table grids to a typed workbook. Pure: no DOM, no pdf.js. */
import type { PageInput } from "../pdf-to-word/lines";
import { parseCell, typeColumn, type Typed } from "./cells";
import { joinAcrossPages, readPages, textRows, type Grid, type PageParts, type TextRow } from "./grid";
import type { CellStyle, Merge, Sheet, Workbook, XCell } from "./xlsx-writer";

export type ExcelLayout = "tables" | "pages";

export type ExcelOptions = {
  /** One sheet per table (tables that run over pages are joined) or one per page. */
  layout: ExcelLayout;
  /** Put the text that is not in a table on a "Text" sheet. */
  includeText: boolean;
};

export type BuildResult = { book: Workbook; tables: number; notes: string[] };

/** How many leading rows are headers. */
export function headerRowCount(grid: Grid): number {
  const rows = grid.rows;
  if (rows.length < 2) return 0;
  const kinds = rows.map((row) => row.map((c) => (c.covered ? "blank" : parseCell(c.text).kind)));
  const hasData = (from: number) => kinds.slice(from).some((r) => r.some((k) => k === "number" || k === "date" || k === "slash"));
  const textOnly = (r: number) => kinds[r].every((k) => k === "text" || k === "blank") && kinds[r].some((k) => k === "text");
  const styled = (r: number) => {
    const filled = rows[r].filter((c) => !c.covered && c.text);
    return filled.length > 0 && (filled.every((c) => c.bold) || rows[r].every((c) => !!c.fill)) &&
      !rows[Math.min(rows.length - 1, r + 1)].every((c) => c.bold || !c.text);
  };
  let n = 0;
  while (n < Math.min(3, rows.length - 1) && textOnly(n) && (hasData(n + 1) || styled(n))) n++;
  if (n === 0 && styled(0)) n = 1;
  return n;
}

function sheetFromGrid(grid: Grid): { sheet: Omit<Sheet, "name">; headerRows: number } {
  const headers = headerRowCount(grid);
  const cols = grid.xs.length - 1;
  const R = grid.rows.length;

  // Type each column from its body cells.
  const typed: Typed[][] = grid.rows.map((row) => row.map(() => ({ kind: "blank" }) as Typed));
  for (let c = 0; c < cols; c++) {
    const idx: number[] = [];
    for (let r = headers; r < R; r++) if (!grid.rows[r][c].covered) idx.push(r);
    const headerText = headers ? grid.rows[headers - 1][c]?.text : undefined;
    const result = typeColumn(idx.map((r) => grid.rows[r][c].text), headerText);
    idx.forEach((r, k) => (typed[r][c] = result[k]));
  }
  for (let r = 0; r < headers; r++) {
    for (let c = 0; c < cols; c++) typed[r][c] = grid.rows[r][c].text ? { kind: "text", text: grid.rows[r][c].text } : { kind: "blank" };
  }
  const numericCol = Array.from({ length: cols }, (_, c) => {
    const body = typed.slice(headers).map((row) => row[c]).filter((t) => t.kind !== "blank");
    return body.length > 0 && body.filter((t) => t.kind === "number").length * 2 > body.length;
  });

  const merges: Merge[] = [];
  const widths = Array.from({ length: cols }, () => 0);
  const rows: XCell[][] = grid.rows.map((row, r) =>
    row.map((cell, c): XCell => {
      const head = r < headers;
      const style: CellStyle = {};
      if (cell.bold || head) style.bold = true;
      if (cell.fill) style.fill = cell.fill;
      else if (head && !grid.rows.some((rr) => rr.some((cc) => cc.fill))) style.border = { bottom: true };
      if (cell.borders.top || cell.borders.bottom || cell.borders.left || cell.borders.right) {
        style.border = { ...style.border, ...cell.borders };
        if (grid.borderColor) style.borderColor = grid.borderColor.toUpperCase();
      }
      if (head && numericCol[c] && cell.colSpan === 1) style.align = "right";
      if (head && cell.colSpan > 1) style.align = "center";
      const styled = Object.keys(style).length ? style : undefined;
      if (cell.covered || !cell.text) return styled && (cell.covered || cell.fill || style.border) ? { v: "", style: styled } : null;
      if (cell.rowSpan > 1 || cell.colSpan > 1) {
        merges.push({ r0: r, c0: c, r1: r + cell.rowSpan - 1, c1: c + cell.colSpan - 1 });
      }
      const t = typed[r][c];
      const shown = cell.text.length;
      if (cell.colSpan === 1) widths[c] = Math.max(widths[c], shown * (cell.bold || head ? 1.12 : 1) + 2.5);
      if (t.kind === "number") return { v: t.value, fmt: t.fmt, style: styled };
      if (t.kind === "date") return { v: t.value, fmt: t.fmt, style: styled };
      const text = cell.text;
      return { v: text, style: shown > 60 ? { ...styled, wrap: true } : styled };
    }),
  );
  return {
    sheet: {
      rows,
      merges,
      colWidths: widths.map((w) => Math.min(60, Math.max(7, Math.round(w * 10) / 10))),
      freeze: headers ? { rows: headers } : undefined,
    },
    headerRows: headers,
  };
}

function textSheet(rows: TextRow[]): Omit<Sheet, "name"> {
  const body: XCell[][] = rows.map((r) => [{ v: r.page, fmt: "0" }, { v: r.text }]);
  return {
    rows: [[{ v: "Page", style: { bold: true, border: { bottom: true } } }, { v: "Text", style: { bold: true, border: { bottom: true } } }], ...body],
    colWidths: [7, Math.min(100, Math.max(20, ...rows.map((r) => r.text.length + 2)))],
    freeze: { rows: 1 },
  };
}

export function buildWorkbook(parts: PageParts[], options: ExcelOptions, title: string): BuildResult {
  const notes: string[] = [];
  const sheets: Sheet[] = [];
  const text: TextRow[] = [];
  let tables = 0;

  if (options.layout === "tables") {
    const { grids, pagesOf } = joinAcrossPages(parts);
    const perPage = new Map<number, number>();
    for (const g of grids) perPage.set(g.page, (perPage.get(g.page) ?? 0) + 1);
    const seenOnPage = new Map<number, number>();
    for (const g of grids) {
      tables++;
      const k = (seenOnPage.get(g.page) ?? 0) + 1;
      seenOnPage.set(g.page, k);
      const pages = pagesOf.get(g)!;
      const label = pages.length > 1 ? `Pages ${pages[0]}-${pages[pages.length - 1]}` : `Page ${g.page}`;
      const name = g.heading ?? (perPage.get(g.page)! > 1 ? `${label} Table ${k}` : label);
      sheets.push({ name, ...sheetFromGrid(g).sheet });
    }
    for (const part of parts) text.push(...textRows(part.rest, part.page, part.furniture));
  } else {
    for (const part of parts) {
      const items: ({ y: number; kind: "grid"; grid: Grid } | { y: number; kind: "text"; row: TextRow })[] = [
        ...part.grids.map((grid) => ({ y: grid.y0, kind: "grid" as const, grid })),
        ...textRows(part.rest, part.page, part.furniture).map((row) => ({ y: row.y - 8, kind: "text" as const, row })),
      ].sort((a, b) => a.y - b.y);
      const rows: XCell[][] = [];
      const merges: Merge[] = [];
      let colWidths: number[] = [];
      let freeze: Sheet["freeze"];
      for (const item of items) {
        if (item.kind === "text") {
          rows.push([{ v: item.row.text }]);
          continue;
        }
        tables++;
        if (rows.length) rows.push([]);
        const { sheet, headerRows } = sheetFromGrid(item.grid);
        if (!rows.length && headerRows) freeze = { rows: headerRows };
        const at = rows.length;
        for (const m of sheet.merges ?? []) merges.push({ r0: m.r0 + at, r1: m.r1 + at, c0: m.c0, c1: m.c1 });
        rows.push(...sheet.rows);
        (sheet.colWidths ?? []).forEach((w, c) => (colWidths[c] = Math.max(colWidths[c] ?? 0, w)));
        rows.push([]);
      }
      colWidths = colWidths.map((w) => w || 8);
      if (rows.length) sheets.push({ name: `Page ${part.page}`, rows, merges, colWidths, freeze });
    }
  }

  if (options.layout === "tables" && (options.includeText || sheets.length === 0) && text.length) {
    sheets.push({ name: "Text", ...textSheet(text) });
  }
  if (!sheets.length) {
    notes.push("No text or tables were found in the pages you picked.");
    sheets.push({ name: "Sheet1", rows: [[]] });
  }
  return { book: { title, sheets }, tables, notes };
}

/** Everything from page inputs to workbook; the browser and the tests both come through here. */
export function pagesToWorkbook(
  inputs: PageInput[],
  pageNumbers: number[],
  options: ExcelOptions,
  title: string,
): BuildResult {
  return buildWorkbook(readPages(inputs, pageNumbers), options, title);
}
