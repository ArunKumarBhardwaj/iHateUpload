import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as XLSX from "xlsx";

import { convertPdfToExcel, type ConvertDeps } from "./index";
import { makeLedgerPdf } from "./testing";

const CORPUS = `${process.cwd()}/bench/pdf-to-word/realistic/corpus`;
const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
const deps: ConvertDeps = { OPS: OPS as unknown as Record<string, number> };

async function convert(
  data: Uint8Array,
  options: Partial<Parameters<typeof convertPdfToExcel>[2]> = {},
  extra: Partial<ConvertDeps> = {},
) {
  const pdf = await getDocument({ data, fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const result = await convertPdfToExcel(
    pdf as never,
    "Doc",
    { layout: "tables", includeText: true, language: "eng", range: "", ...options },
    { ...deps, ...extra },
    () => {},
  );
  const wb = XLSX.read(result.bytes, { cellNF: true, cellStyles: true });
  return { result, wb, zip: await JSZip.loadAsync(result.bytes) };
}
const corpus = (name: string) => new Uint8Array(readFileSync(`${CORPUS}/${name}.pdf`));
const grid = (wb: XLSX.WorkBook, name: string) =>
  XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, raw: true, blankrows: false });

test("ledger: typed cells, merged group header, frozen header, fills and borders", async () => {
  const { wb, zip, result } = await convert(await makeLedgerPdf());
  expect(result.tables).toBe(1);
  // The heading above the table names the sheet.
  expect(wb.SheetNames[0]).toBe("Regional Sales");
  const ws = wb.Sheets["Regional Sales"];
  // Leading zeros stay text; quantities, money and percents are numbers.
  expect(ws.A3.t).toBe("s");
  expect(ws.A3.v).toBe("00123");
  expect(ws.C3.v).toBe(1200);
  expect(ws.C4.v).toBe(-300);
  expect(ws.D3.v).toBe(45000.5);
  expect(ws.D3.z).toBe('"$"#,##0.00');
  expect(ws.D4.v).toBe(-1200);
  expect(ws.E3.v).toBeCloseTo(0.125, 6);
  expect(ws.E3.z).toBe("0.0%");
  expect(ws.E4.v).toBeCloseTo(-0.032, 6);
  // Dates are real dates.
  expect(ws.F3.t).toBe("n");
  expect(ws.F3.v).toBe(46084);
  expect(ws.F3.z).toBe("yyyy-mm-dd");
  // Group header merged across Units..Date.
  expect(ws.C1.v).toBe("Q1 results");
  expect(ws["!merges"]).toContainEqual({ s: { r: 0, c: 2 }, e: { r: 0, c: 5 } });
  const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  expect(xml).toContain('<pane ySplit="2"');
  const styles = await zip.file("xl/styles.xml")!.async("string");
  expect(styles).toContain("<b/>");
  expect(styles).toContain('rgb="FFD9E3F2"');
  expect(styles).toContain('<left style="thin">');
  // Column widths follow the content.
  expect(xml).toMatch(/<col min="4" max="4" width="1\d(\.\d+)?" customWidth="1"\/>/);
  // The prose under the heading is on the Text sheet.
  expect(wb.SheetNames).toContain("Text");
  expect(grid(wb, "Text").flat().join(" ")).toContain("Prepared for the board");
});

test("invoice: one table sheet named from its heading, amounts as currency numbers", async () => {
  const { wb, result } = await convert(corpus("invoice"));
  expect(result.tables).toBe(1);
  expect(wb.SheetNames[0]).toBe("INVOICE");
  const rows = grid(wb, "INVOICE");
  expect(rows[0]).toEqual(["Description", "Qty", "Unit price", "Amount"]);
  expect(rows[1]).toEqual(["Stainless mixing bowl, 12 qt", 6, 38.5, 231]);
  expect(rows[rows.length - 1][3]).toBe(838.18);
  expect(wb.Sheets.INVOICE.D2.z).toBe('"$"#,##0.00');
});

test("a table that runs over three pages is one sheet, with loose end rows brought in", async () => {
  const { wb, result } = await convert(corpus("bank-statement"));
  expect(result.tables).toBe(1);
  const rows = grid(wb, "Statement of Account");
  expect(rows.length).toBe(65);
  expect(rows[0]).toEqual(["Date", "Description", "Debit", "Credit", "Balance"]);
  // Dates came through as dates (the column settles on month first from 06/29).
  expect(wb.Sheets["Statement of Account"].A2.v).toBe(46174);
  expect(rows[rows.length - 1].slice(1)).toEqual(["Oakridge Cafe", 60.61, undefined, 23576.63]);
  // Running header, footer and page numbers are left out of the Text sheet.
  const text = grid(wb, "Text").flat().join(" ");
  expect(text).not.toContain("Page 2 of 3");
  expect(text).not.toContain("Account ending");
  expect(text).toContain("Closing balance");
});

test("wide ruled table over two pages", async () => {
  const { wb } = await convert(corpus("spreadsheet"));
  const rows = grid(wb, wb.SheetNames[0]);
  expect(rows.length).toBe(31);
  expect(rows[0].length).toBe(9);
  expect(rows[1]).toEqual(["North", "A. Nolan", 6894, 2533, 5582, 2289, 1590, 7647, 26535]);
});

test("page layout gives one sheet per page, tables stacked under their text", async () => {
  const { wb } = await convert(corpus("bank-statement"), { layout: "pages" });
  expect(wb.SheetNames).toEqual(["Page 1", "Page 2", "Page 3"]);
  expect(grid(wb, "Page 1")[0]).toEqual(["Statement of Account"]);
});

test("the Text sheet can be left out unless nothing else is there", async () => {
  const withTables = await convert(corpus("invoice"), { includeText: false });
  expect(withTables.wb.SheetNames).toEqual(["INVOICE"]);
  const prose = await convert(corpus("report-chart"), { includeText: false });
  expect(prose.wb.SheetNames).toEqual(["Text"]);
});

test("page range limits what is read", async () => {
  const { wb, result } = await convert(corpus("bank-statement"), { range: "2" });
  expect(result.pages).toBe(1);
  expect(grid(wb, wb.SheetNames[0]).length).toBe(34);
});

test("a page with no text layer goes through OCR before tables are found", async () => {
  const ocrItems = (rows: string[][]) =>
    rows.flatMap((cells, r) =>
      cells.map((str, c) => ({
        str,
        x: 60 + c * 120,
        y: 120 + r * 20,
        w: str.length * 6,
        size: 11,
        font: "Arial",
        bold: false,
        italic: false,
        generic: "sans" as const,
      })),
    );
  const items = ocrItems([
    ["Item", "Qty", "Price"],
    ["Apples", "3", "4.50"],
    ["Pears", "7", "9.10"],
    ["Plums", "2", "3.25"],
  ]);
  // A one-page scan: an image and no text.
  const { PDFDocument } = await import("@cantoo/pdf-lib");
  const { makePng } = await import("../pdf-to-word/fixture");
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawImage(await doc.embedPng(makePng(40, 40, [240, 240, 240])), { x: 0, y: 0, width: 612, height: 792 });
  const seen: number[] = [];
  const { wb } = await convert(await doc.save(), {}, {
    readScan: async (_p, n) => {
      seen.push(n);
      return items;
    },
  });
  expect(seen).toEqual([1]);
  const rows = grid(wb, wb.SheetNames[0]);
  expect(rows[1]).toEqual(["Apples", 3, 4.5]);
});
