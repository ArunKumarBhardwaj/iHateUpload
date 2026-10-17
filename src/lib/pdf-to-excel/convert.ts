/** Table grids to a typed workbook. Pure: no DOM, no pdf.js. */
import type { PageInput } from "../pdf-to-word/lines";
import { parseCell, typeColumn, type Typed } from "./cells";
import { joinAcrossPages, readPages, textRows, type Grid, type PageParts, type TextRow } from "./grid";
import type { CellStyle, Merge, Sheet, Workbook, XCell } from "./xlsx-writer";

export type ExcelLayout = "tables" | "pages" | "one";

export type ExcelOptions = {
  /** One sheet per table (tables that run over pages are joined) or one per page. */
  layout: ExcelLayout;
  /** Put the text that is not in a table on a "Text" sheet. */
  includeText: boolean;
  /** Numbers and dates become real cells. On unless set to false. */
  typed?: boolean;
  /** Fills, borders and bold from the PDF. On unless set to false. */
  formatting?: boolean;
  /** Freeze the header rows and add a filter to them. On unless set to false. */
  freezeFilter?: boolean;
  /** Join a table that runs over pages. On unless set to false. */
  joinPages?: boolean;
};

type Flags = { typed: boolean; formatting: boolean; freezeFilter: boolean };

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

function sheetFromGrid(grid: Grid, flags: Flags): { sheet: Omit<Sheet, "name">; headerRows: number } {
  const headers = headerRowCount(grid);
  const cols = grid.xs.length - 1;
  const R = grid.rows.length;

  // Type each column from its body cells.
  const typed: Typed[][] = grid.rows.map((row) => row.map(() => ({ kind: "blank" }) as Typed));
  for (let c = 0; c < cols; c++) {
    const idx: number[] = [];
    for (let r = headers; r < R; r++) if (!grid.rows[r][c].covered) idx.push(r);
    const headerText = headers ? grid.rows[headers - 1][c]?.text : undefined;
    const texts = idx.map((r) => grid.rows[r][c].text);
    const result: Typed[] = flags.typed
      ? typeColumn(texts, headerText)
      : texts.map((t) => (t.trim() ? { kind: "text", text: t } : { kind: "blank" }));
    idx.forEach((r, k) => (typed[r][c] = result[k]));
  }
  for (let r = 0; r < headers; r++) {
    for (let c = 0; c < cols; c++) typed[r][c] = grid.rows[r][c].text ? { kind: "text", text: grid.rows[r][c].text } : { kind: "blank" };
  }
  const numericCol = Array.from({ length: cols }, (_, c) => {
    const body = typed.slice(headers).map((row) => row[c]).filter((t) => t.kind !== "blank");
    return body.length > 0 && body.filter((t) => t.kind === "number" || t.kind === "date").length * 2 > body.length;
  });

  const merges: Merge[] = [];
  const widths = Array.from({ length: cols }, () => 0);
  const rows: XCell[][] = grid.rows.map((row, r) =>
    row.map((cell, c): XCell => {
      const head = r < headers;
      const style: CellStyle = {};
      if ((flags.formatting && cell.bold) || head) style.bold = true;
      if (flags.formatting && cell.fill) style.fill = cell.fill;
      else if (head && !(flags.formatting && grid.rows.some((rr) => rr.some((cc) => cc.fill)))) style.border = { bottom: true };
      if (flags.formatting && (cell.borders.top || cell.borders.bottom || cell.borders.left || cell.borders.right)) {
        style.border = { ...style.border, ...cell.borders };
        if (grid.borderColor) style.borderColor = grid.borderColor.toUpperCase();
      }
      if (head && numericCol[c] && cell.colSpan === 1) style.align = "right";
      if (head && cell.colSpan > 1) style.align = "center";
      const styled = Object.keys(style).length ? style : undefined;
      if (cell.covered || !cell.text) return styled && (cell.covered || style.fill || style.border) ? { v: "", style: styled } : null;
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
      freeze: headers && flags.freezeFilter ? { rows: headers } : undefined,
      autoFilter: headers && flags.freezeFilter ? { row: headers - 1, cols } : undefined,
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

type Stacked = { rows: XCell[][]; merges: Merge[]; colWidths: number[]; freeze?: Sheet["freeze"] };

/** Tables and lines of text one under another, sharing columns. */
function stack(items: ({ kind: "grid"; grid: Grid; title?: string } | { kind: "text"; text: string })[], flags: Flags): Stacked {
  const out: Stacked = { rows: [], merges: [], colWidths: [] };
  for (const item of items) {
    if (item.kind === "text") {
      out.rows.push([{ v: item.text }]);
      continue;
    }
    if (out.rows.length) out.rows.push([]);
    if (item.title) out.rows.push([{ v: item.title, style: { bold: true } }]);
    const { sheet, headerRows } = sheetFromGrid(item.grid, flags);
    if (!out.rows.length && headerRows && flags.freezeFilter) out.freeze = { rows: headerRows };
    const at = out.rows.length;
    for (const m of sheet.merges ?? []) out.merges.push({ r0: m.r0 + at, r1: m.r1 + at, c0: m.c0, c1: m.c1 });
    out.rows.push(...sheet.rows);
    (sheet.colWidths ?? []).forEach((w, c) => (out.colWidths[c] = Math.max(out.colWidths[c] ?? 0, w)));
    out.rows.push([]);
  }
  out.colWidths = Array.from(out.colWidths, (w) => w || 8);
  return out;
}

export function buildWorkbook(parts: PageParts[], options: ExcelOptions, title: string): BuildResult {
  const flags: Flags = {
    typed: options.typed !== false,
    formatting: options.formatting !== false,
    freezeFilter: options.freezeFilter !== false,
  };
  const notes: string[] = [];
  const sheets: Sheet[] = [];
  const text: TextRow[] = [];
  let tables = 0;

  if (options.layout !== "pages") {
    const { grids, pagesOf } = joinAcrossPages(parts, options.joinPages !== false);
    const perPage = new Map<number, number>();
    for (const g of grids) perPage.set(g.page, (perPage.get(g.page) ?? 0) + 1);
    const seenOnPage = new Map<number, number>();
    const named = grids.map((g) => {
      const k = (seenOnPage.get(g.page) ?? 0) + 1;
      seenOnPage.set(g.page, k);
      const pages = pagesOf.get(g)!;
      const label = pages.length > 1 ? `Pages ${pages[0]}-${pages[pages.length - 1]}` : `Page ${g.page}`;
      return { grid: g, name: g.heading ?? (perPage.get(g.page)! > 1 ? `${label} Table ${k}` : label) };
    });
    tables = grids.length;
    if (options.layout === "one") {
      if (named.length) {
        const stacked = stack(named.map((n) => ({ kind: "grid" as const, grid: n.grid, title: n.name })), { ...flags, freezeFilter: false });
        sheets.push({ name: "All tables", rows: stacked.rows, merges: stacked.merges, colWidths: stacked.colWidths });
      }
    } else {
      for (const n of named) sheets.push({ name: n.name, ...sheetFromGrid(n.grid, flags).sheet });
    }
    for (const part of parts) text.push(...textRows(part.rest, part.page, part.furniture));
  } else {
    for (const part of parts) {
      const items = [
        ...part.grids.map((grid) => ({ y: grid.y0, item: { kind: "grid" as const, grid } })),
        ...(options.includeText
          ? textRows(part.rest, part.page, part.furniture).map((row) => ({ y: row.y - 8, item: { kind: "text" as const, text: row.text } }))
          : []),
      ].sort((a, b) => a.y - b.y);
      tables += part.grids.length;
      const stacked = stack(items.map((i) => i.item), flags);
      if (stacked.rows.length) sheets.push({ name: `Page ${part.page}`, ...stacked });
    }
  }

  if (options.layout !== "pages" && (options.includeText || sheets.length === 0) && text.length) {
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
