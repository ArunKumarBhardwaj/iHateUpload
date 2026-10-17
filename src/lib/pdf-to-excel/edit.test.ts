import { expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { pagesToPrepared } from "./convert";
import { createEditor, deleteColumn, deleteRow, setCell, setColumnType, setHeaderRows } from "./edit";
import { loadPages, makeLedgerPdf } from "./testing";

async function ledger() {
  const pages = await loadPages(await makeLedgerPdf());
  return createEditor(pagesToPrepared(pages, [1], { layout: "tables", includeText: true }, "t"));
}
const sheetRows = (bytes: Uint8Array, name: string) =>
  XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(bytes, { cellNF: true }).Sheets[name], { header: 1 });

test("columns show what was inferred and how many cells do not fit", async () => {
  const ed = await ledger();
  const grid = ed.tables()[0];
  const info = ed.columns(grid);
  expect(info.map((c) => c.kind)).toEqual(["text", "text", "number", "currency", "percent", "date"]);
  expect(info.every((c) => c.inferred)).toBe(true);
  expect(ed.warnings()).toBe(0);
  // A bad value in a number column is counted.
  setCell(grid, 3, 2, "n/a");
  expect(ed.columns(grid)[2].warnings).toBe(1);
  expect(ed.warnings()).toBe(1);
});

test("an edited cell, a renamed sheet and a forced column type reach the file", async () => {
  const ed = await ledger();
  const grid = ed.tables()[0];
  grid.name = "Q1";
  setCell(grid, 2, 1, "Northwest");
  setColumnType(grid, 0, "number"); // IDs forced to numbers
  setColumnType(grid, 5, "text"); // dates forced to text
  expect(ed.columns(grid)[0]).toMatchObject({ kind: "number", inferred: false });
  const { bytes } = await ed.build();
  const rows = sheetRows(bytes, "Q1");
  expect(rows[2][1]).toBe("Northwest");
  expect(rows[2][0]).toBe(123);
  expect(rows[2][5]).toBe("2026-03-03");
});

test("percent and currency can be forced on plain numbers", async () => {
  const ed = await ledger();
  const grid = ed.tables()[0];
  setColumnType(grid, 2, "percent");
  setColumnType(grid, 5, "date");
  const wb = XLSX.read((await ed.build()).bytes, { cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  expect(ws.C3.v).toBeCloseTo(12, 6);
  expect(ws.C3.z).toContain("%");
  expect(ws.F3.v).toBe(46084);
});

test("delete a row or a column, and change how many header rows there are", async () => {
  const ed = await ledger();
  const grid = ed.tables()[0];
  deleteRow(grid, 3);
  deleteColumn(grid, 1);
  setHeaderRows(grid, 1);
  const { bytes } = await ed.build();
  const rows = sheetRows(bytes, grid.name!);
  expect(rows.length).toBe(4);
  expect(rows[1]).toEqual(["Code", "Units", "Revenue", "Change", "Date"]);
  expect(rows[2][0]).toBe("00123");
  expect(rows.some((r) => r[0] === "00456")).toBe(false);
  const xml = XLSX.read(bytes).Sheets[grid.name!];
  expect(xml["!merges"] ?? []).toEqual([]);
});

test("a table can be left out of the export", async () => {
  const ed = await ledger();
  ed.tables()[0].skip = true;
  const { book } = await ed.build();
  expect(book.sheets.map((s) => s.name)).not.toContain("Regional Sales");
});
