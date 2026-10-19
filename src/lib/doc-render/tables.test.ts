import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { defaultDocOptions } from "./options";
import { convertDoc } from "./process";
import { parseCsv } from "./tables";
import { loadFont, pdfPages } from "./testkit";

const norm = (s: string) => s.replace(/\s+/g, " ");

function csvOf(rows: number) {
  const lines = ["id,name,amount,note"];
  for (let i = 1; i <= rows; i++) lines.push(`${i},"Item, ${i}",${(i * 12.5).toFixed(2)},"said ""hi"""`);
  return lines.join("\n");
}

const asData = (text: string) => ({
  text: async () => text,
  bytes: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
});

describe("csv parsing", () => {
  test("quotes, embedded commas and newlines, delimiters", () => {
    expect(parseCsv('a,"b,c","d ""q"""\n1,2,3')).toEqual([["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
    expect(parseCsv("a;b\n1;2")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv('x,"l1\nl2"')).toEqual([["x", "l1\nl2"]]);
  });
});

describe("csv to pdf", () => {
  test("repeats the header on every page, titles, footers and keeps every row", async () => {
    const o = { ...defaultDocOptions("csv") };
    const out = await convertDoc("sales.csv", asData(csvOf(150)), o, { loadFont });
    const pages = (await pdfPages(out.bytes)).map(norm);
    expect(pages.length).toBeGreaterThan(2);
    expect(pages[0]).toContain("sales");
    for (const p of pages) {
      expect(p).toContain("amount");
      expect(p).toMatch(/Page \d+ of \d+/);
    }
    expect(pages.join(" ")).toContain("Item, 150");
    expect(pages.join(" ")).toContain("said \"hi\"");
  });

  test("orientation and paper size apply", async () => {
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const o = { ...defaultDocOptions("csv"), paper: "letter" as const, landscape: false };
    const out = await convertDoc("a.csv", asData("a,b\n1,2"), o, { loadFont });
    const page = (await PDFDocument.load(out.bytes)).getPage(0);
    expect(Math.round(page.getWidth())).toBe(612);
    expect(Math.round(page.getHeight())).toBe(792);
  });
});

function workbook() {
  const wb = XLSX.utils.book_new();
  const rows = [["Region", "Revenue", "Share", "Date"]];
  for (let i = 1; i <= 90; i++) rows.push([`Region ${i}`, 1000 * i + 0.5, i / 100, ""] as never);
  const a = XLSX.utils.aoa_to_sheet(rows);
  for (let i = 1; i <= 90; i++) {
    a[`B${i + 1}`].z = "$#,##0.00";
    a[`C${i + 1}`].z = "0%";
  }
  a["!cols"] = [{ wch: 18 }, { wch: 14 }, { wch: 8 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, a, "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Only", "Here"], ["x", "y"]]), "Second");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["secret"], ["hidden"]]), "Hidden");
  wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 0 }, { Hidden: 1 }] };
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

describe("excel to pdf", () => {
  const bytes = workbook();
  const data = { text: async () => "", bytes: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer };

  test("all visible sheets, formatted numbers, repeated header, footer", async () => {
    const out = await convertDoc("book.xlsx", data, defaultDocOptions("excel"), { loadFont });
    const pages = (await pdfPages(out.bytes)).map(norm);
    const all = pages.join(" ");
    expect(all).toContain("$1,000.50");
    expect(all).toContain("5%");
    expect(all).toContain("Only");
    expect(all).not.toContain("secret");
    const summary = pages.filter((p) => p.includes("Region"));
    expect(summary.length).toBeGreaterThan(1);
    for (const p of summary) expect(p).toContain("Revenue");
    expect(all).toMatch(/Page 1 of/);
    expect(pages[0]).toContain("Summary");
  });

  test("sheet picker keeps only the chosen sheet", async () => {
    const out = await convertDoc("book.xlsx", data, { ...defaultDocOptions("excel"), sheets: ["Second"] }, { loadFont });
    const all = norm((await pdfPages(out.bytes)).join(" "));
    expect(all).toContain("Only");
    expect(all).not.toContain("Region 1");
  });
});

describe("csv view (sort, filter, hide columns)", () => {
  const rows = parseCsv("name,qty,city\nPen,10,Oslo\nBook,9,Lima\nCup,100,oslo\nBag,,Pune\n");
  const names = (r: string[][]) => r.slice(1).map((x) => x[0]);

  test("sorts numbers by value, text by locale, empties last, header stays first", async () => {
    const { applyCsvView } = await import("./tables");
    expect(names(applyCsvView(rows, { sort: { col: 1, dir: "asc" }, filter: "", hidden: [] }))).toEqual(["Book", "Pen", "Cup", "Bag"]);
    expect(names(applyCsvView(rows, { sort: { col: 1, dir: "desc" }, filter: "", hidden: [] }))).toEqual(["Cup", "Pen", "Book", "Bag"]);
    expect(names(applyCsvView(rows, { sort: { col: 0, dir: "asc" }, filter: "", hidden: [] }))).toEqual(["Bag", "Book", "Cup", "Pen"]);
    expect(applyCsvView(rows, { sort: { col: 0, dir: "asc" }, filter: "", hidden: [] })[0]).toEqual(["name", "qty", "city"]);
  });

  test("filters rows by any shown cell, ignoring case; hidden columns are not searched and are dropped", async () => {
    const { applyCsvView } = await import("./tables");
    expect(names(applyCsvView(rows, { sort: null, filter: "OSLO", hidden: [] }))).toEqual(["Pen", "Cup"]);
    const v = applyCsvView(rows, { sort: null, filter: "oslo", hidden: [2] });
    expect(v).toEqual([["name", "qty"]]);
    expect(applyCsvView(rows, { sort: null, filter: "", hidden: [1] })[1]).toEqual(["Pen", "Oslo"]);
  });

  test("a sort column past the end is ignored", async () => {
    const { applyCsvView } = await import("./tables");
    expect(names(applyCsvView(rows, { sort: { col: 9, dir: "asc" }, filter: "", hidden: [] }))).toEqual(["Pen", "Book", "Cup", "Bag"]);
  });

  test("the PDF follows the chosen view and the options", async () => {
    const o = { ...defaultDocOptions("csv"), csvSort: { col: 1, dir: "desc" as const }, csvFilter: "p", csvHidden: [2] };
    const out = await convertDoc("t.csv", { text: async () => "name,qty,city\nPen,10,Oslo\nBook,9,Lima\nCup,100,oslo\n", bytes: async () => new ArrayBuffer(0) }, o, { loadFont });
    const text = norm((await pdfPages(out.bytes)).join(" "));
    expect(text).toContain("Cup");
    expect(text).toContain("Pen");
    expect(text).not.toContain("Book");
    expect(text).not.toContain("Oslo");
    expect(text.indexOf("Cup")).toBeLessThan(text.indexOf("Pen"));
  });
});
