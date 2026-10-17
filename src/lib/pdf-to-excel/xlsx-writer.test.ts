import { expect, test } from "bun:test";
import JSZip from "jszip";
import * as XLSX from "xlsx";

import { safeSheetName, writeXlsx, type Workbook } from "./xlsx-writer";

const book: Workbook = {
  title: "Test",
  sheets: [
    {
      name: "Invoice",
      rows: [
        [
          { v: "Item", style: { bold: true, fill: "D9E2F3", border: { top: true, bottom: true, left: true, right: true } } },
          { v: "Qty", style: { bold: true, fill: "D9E2F3" } },
          { v: "Amount", style: { bold: true, fill: "D9E2F3" } },
        ],
        [{ v: "Bowl <12 qt> & lid" }, { v: 6, fmt: "0" }, { v: 231, fmt: '"$"#,##0.00' }],
        [{ v: "007" }, { v: 46084, fmt: "yyyy-mm-dd" }, { v: -0.125, fmt: "0.0%" }],
        [{ v: "Total due", style: { bold: true } }, null, { v: 838.18, fmt: '"$"#,##0.00' }],
      ],
      merges: [{ r0: 3, c0: 0, r1: 3, c1: 1 }],
      colWidths: [24, 8, 14],
      freeze: { rows: 1 },
    },
    { name: "Text", rows: [[{ v: "  padded " }]] },
  ],
};

test("writes a workbook that SheetJS reads back with real types", async () => {
  const bytes = await writeXlsx(book);
  const wb = XLSX.read(bytes, { cellNF: true });
  expect(wb.SheetNames).toEqual(["Invoice", "Text"]);
  const ws = wb.Sheets.Invoice;
  expect(ws.A2.v).toBe("Bowl <12 qt> & lid");
  expect(ws.B2.t).toBe("n");
  expect(ws.B2.v).toBe(6);
  expect(ws.C2.v).toBe(231);
  expect(ws.C2.z).toBe('"$"#,##0.00');
  expect(ws.A3.t).toBe("s");
  expect(ws.A3.v).toBe("007");
  expect(ws.B3.v).toBe(46084);
  expect(ws.B3.z).toBe("yyyy-mm-dd");
  expect(ws.C3.v).toBe(-0.125);
  expect(ws["!merges"]?.[0]).toEqual({ s: { r: 3, c: 0 }, e: { r: 3, c: 1 } });
  expect(wb.Sheets.Text.A1.v).toBe("  padded ");
});

test("styles, widths and the frozen header land in the XML", async () => {
  const zip = await JSZip.loadAsync(await writeXlsx(book));
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  expect(sheet).toContain('<pane ySplit="1"');
  expect(sheet).toContain('state="frozen"');
  expect(sheet).toContain('<col min="1" max="1" width="24" customWidth="1"/>');
  expect(sheet).toContain('<mergeCell ref="A4:B4"/>');
  const styles = await zip.file("xl/styles.xml")!.async("string");
  expect(styles).toContain("<b/>");
  expect(styles).toContain('rgb="FFD9E2F3"');
  expect(styles).toContain("<left style=\"thin\">");
});

test("control characters are stripped and the file stays well formed", async () => {
  const bytes = await writeXlsx({ title: "x", sheets: [{ name: "A", rows: [[{ v: "bad\u0001\u0008 text" }]] }] });
  const wb = XLSX.read(bytes);
  expect(wb.Sheets.A.A1.v).toBe("bad text");
});

test("sheet names are legal and unique", () => {
  const used = new Set<string>();
  expect(safeSheetName("Q1: Sales / North [draft]", used)).toBe("Q1 Sales North draft");
  expect(safeSheetName("Q1: Sales / North [draft]", used)).toBe("Q1 Sales North draft 2");
  expect(safeSheetName("", used)).toBe("Sheet");
  expect(safeSheetName("x".repeat(50), used).length).toBe(31);
  expect(safeSheetName("History", new Set<string>()).toLowerCase()).toBe("history");
});
