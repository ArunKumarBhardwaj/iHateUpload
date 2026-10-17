import { expect, test } from "bun:test";

import type { Grid, GridCellData } from "./grid";
import { fixOcrGrid } from "./ocr-fix";

const cell = (text: string): GridCellData => ({ text, bold: false, borders: {}, rowSpan: 1, colSpan: 1 });
const grid = (rows: string[][]): Grid => ({
  page: 1,
  y0: 0,
  y1: 100,
  xs: Array.from({ length: rows[0].length + 1 }, (_, i) => i * 50),
  rows: rows.map((r) => r.map(cell)),
  bordered: false,
  rowPitch: 12,
});
const texts = (g: Grid) => g.rows.map((r) => r.map((c) => c.text));

test("letters in a number column become digits only when the result is a number", () => {
  const g = grid([
    ["Item", "Qty", "Price"],
    ["Bolt", "1,5O8", "$1,O58.05"],
    ["Nut", "l0", "$B8.50"],
    ["Cap", "5O5", "$S.55"],
    ["Pin", "12", "$2.00"],
    ["Cog", "n/a", "$3.00"],
  ]);
  const fixed = fixOcrGrid(g);
  expect(texts(g).slice(1)).toEqual([
    ["Bolt", "1,508", "$1,058.05"],
    ["Nut", "10", "$88.50"],
    ["Cap", "505", "$5.55"],
    ["Pin", "12", "$2.00"],
    ["Cog", "n/a", "$3.00"],
  ]);
  expect(fixed).toBe(6);
});

test("a short run of look-alike letters in a number column is a number", () => {
  const g = grid([["Qty"], ["BO"], ["12"], ["505"], ["1l"]]);
  fixOcrGrid(g);
  expect(texts(g).map((r) => r[0])).toEqual(["Qty", "80", "12", "505", "11"]);
});

test("a header word in a number column is left alone", () => {
  const g = grid([
    ["Item", "Qty", "Price"],
    ["Bolt", "10", "$1.00"],
    ["Nut", "20", "$2.00"],
    ["Pin", "30", "$3.00"],
  ]);
  expect(fixOcrGrid(g)).toBe(0);
  expect(texts(g)[0]).toEqual(["Item", "Qty", "Price"]);
});

test("a number followed by a unit gets the unit letters back", () => {
  const g = grid([
    ["Part", "Size"],
    ["Filter", "12 gt"],
    ["Clamp", "5 ga1"],
    ["Kit", "16 0z"],
    ["Rod", "1 1b"],
    ["Tube", "8 oz"],
  ]);
  fixOcrGrid(g);
  expect(texts(g).map((r) => r[1])).toEqual(["Size", "12 qt", "5 gal", "16 oz", "1 lb", "8 oz"]);
});

test("a unit stuck to its number is set apart when the column writes them apart", () => {
  const g = grid([
    ["Part", "Size"],
    ["Brake fluid", "2qt"],
    ["Grease", "8 oz"],
    ["Plug", "1lb"],
    ["Blade", "20 in"],
    ["Hose", "5 gal"],
  ]);
  fixOcrGrid(g);
  expect(texts(g).map((r) => r[1])).toEqual(["Size", "2 qt", "8 oz", "1 lb", "20 in", "5 gal"]);
  const tight = grid([
    ["Part", "Size"],
    ["A", "500g"],
    ["B", "250g"],
    ["C", "1kg"],
  ]);
  fixOcrGrid(tight);
  expect(texts(tight).map((r) => r[1])).toEqual(["Size", "500g", "250g", "1kg"]);
});

test("text columns are not turned into numbers, and ids with digits are kept", () => {
  const g = grid([
    ["Code", "Name"],
    ["B5S10", "Stainless bowl"],
    ["SKU0042", "Co1d brew"],
    ["A1B2", "Oats"],
  ]);
  fixOcrGrid(g);
  expect(texts(g).map((r) => r[0])).toEqual(["Code", "B5S10", "SKU0042", "A1B2"]);
  expect(texts(g)[2][1]).toBe("Cold brew");
  const q = grid([["Part"], ["Qil filter"], ["Quartz tile"], ["Hose"]]);
  fixOcrGrid(q);
  expect(texts(q).map((r) => r[0])).toEqual(["Part", "Oil filter", "Quartz tile", "Hose"]);
});
