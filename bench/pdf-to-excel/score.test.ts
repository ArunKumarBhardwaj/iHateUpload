import { expect, test } from "bun:test";

import { writeXlsx } from "../../src/lib/pdf-to-excel/xlsx-writer";
import { dateKeys, numberOf, readSheets, scoreWorkbook, type TruthTable } from "./score";

const truth: TruthTable = {
  rows: [
    [{ text: "Item" }, { text: "Date" }, { text: "Amount" }],
    [{ text: "Bowl" }, { text: "06/29/2026" }, { text: "$1,200.50" }],
    [{ text: "Lid" }, { text: "06/30/2026" }, { text: "(45.00)" }],
  ],
};

const sheetOf = async (rows: Parameters<typeof writeXlsx>[0]["sheets"][0]["rows"]) =>
  readSheets(await writeXlsx({ sheets: [{ name: "T", rows }] }));

test("numbers and dates are read the way people write them", () => {
  expect(numberOf("$1,200.50")).toEqual({ value: 1200.5, percent: false });
  expect(numberOf("(45.00)")).toEqual({ value: -45, percent: false });
  expect(numberOf("45.00-")).toEqual({ value: -45, percent: false });
  expect(numberOf("12%")).toEqual({ value: 12, percent: true });
  expect(numberOf("007")).toBeNull();
  expect(dateKeys("06/29/2026")).toContain("2026-6-29");
  expect(dateKeys("3 March 2026")).toEqual(["2026-3-3"]);
});

test("typed output scores full marks for cells and for typing", async () => {
  const sheets = await sheetOf([
    [{ v: "Item" }, { v: "Date" }, { v: "Amount" }],
    [{ v: "Bowl" }, { v: 46202, fmt: "mm/dd/yyyy" }, { v: 1200.5, fmt: '"$"#,##0.00' }],
    [{ v: "Lid" }, { v: 46203, fmt: "mm/dd/yyyy" }, { v: -45, fmt: "0.00" }],
  ]);
  const score = scoreWorkbook([truth], sheets);
  expect(score.cells).toBe(1);
  expect(score.typed).toBe(1);
  expect(score.tablesOk).toBe(true);
});

test("text copies match in content but are not typed", async () => {
  const sheets = await sheetOf([
    [{ v: "Item" }, { v: "Date" }, { v: "Amount" }],
    [{ v: "Bowl" }, { v: "06/29/2026" }, { v: "$1,200.50" }],
    [{ v: "Lid" }, { v: "06/30/2026" }, { v: "(45.00)" }],
  ]);
  const score = scoreWorkbook([truth], sheets);
  expect(score.cells).toBe(1);
  expect(score.typed).toBe(0);
});

test("rows are aligned even with extra rows and a shifted column", async () => {
  const sheets = await sheetOf([
    [{ v: "Acme Ltd" }],
    [],
    [null, { v: "Item" }, { v: "Date" }, { v: "Amount" }],
    [null, { v: "Bowl" }, { v: 46202, fmt: "mm/dd/yyyy" }, { v: 1200.5 }],
    [null, { v: "Lid" }, { v: 46203, fmt: "mm/dd/yyyy" }, { v: -45 }],
    [null, { v: "Total" }, null, { v: 1155.5 }],
  ]);
  const score = scoreWorkbook([truth], sheets);
  expect(score.cells).toBeGreaterThan(0.8);
  expect(score.cells).toBeLessThan(1);
  expect(score.typed).toBe(1);
});

test("wrong values and wrong table counts are penalised", async () => {
  const sheets = await sheetOf([
    [{ v: "Item" }, { v: "Date" }, { v: "Amount" }],
    [{ v: "Bowl" }, { v: "x" }, { v: 9 }],
    [{ v: "Lid" }, { v: "y" }, { v: 8 }],
  ]);
  const score = scoreWorkbook([truth, truth], sheets);
  expect(score.cells).toBeLessThan(0.6);
  expect(score.tablesOk).toBe(false);
});
