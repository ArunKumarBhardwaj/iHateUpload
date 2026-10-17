import { expect, test } from "bun:test";

import { parseCell, typeColumn } from "./cells";

const num = (text: string) => {
  const c = parseCell(text);
  return c.kind === "number" ? { v: c.value, f: c.fmt } : c;
};

test("plain and separated numbers become numbers", () => {
  expect(num("6894")).toEqual({ v: 6894, f: "0" });
  expect(num("1,384.00")).toEqual({ v: 1384, f: "#,##0.00" });
  expect(num("23,576.63")).toEqual({ v: 23576.63, f: "#,##0.00" });
  expect(num("-12.5")).toEqual({ v: -12.5, f: "0.0" });
  expect(num("3.14159")).toEqual({ v: 3.14159, f: "0.00000" });
});

test("currency symbols move into the number format", () => {
  expect(num("$838.18")).toEqual({ v: 838.18, f: '"$"#,##0.00' });
  expect(num("€1,200")).toEqual({ v: 1200, f: '"€"#,##0' });
  expect(num("-$5.00")).toEqual({ v: -5, f: '"$"#,##0.00' });
  expect(num("$-5.00")).toEqual({ v: -5, f: '"$"#,##0.00' });
});

test("parentheses and trailing minus are negative", () => {
  expect(num("(1,234.50)")).toEqual({ v: -1234.5, f: "#,##0.00_);\\(#,##0.00\\)" });
  expect(num("($20.00)")).toEqual({ v: -20, f: '"$"#,##0.00_);\\("$"#,##0.00\\)' });
  expect(num("45.10-")).toEqual({ v: -45.1, f: "0.00" });
});

test("percentages keep their decimals and become fractions", () => {
  expect(parseCell("12.5%")).toEqual({ kind: "number", value: 0.125, fmt: "0.0%" });
  expect(num("8%")).toEqual({ v: 0.08, f: "0%" });
});

test("identifiers stay text", () => {
  expect(parseCell("007").kind).toBe("text");
  expect(parseCell("00123456").kind).toBe("text");
  expect(parseCell("2047-0193").kind).toBe("text");
  expect(parseCell("15551234567890").kind).toBe("text");
  expect(parseCell("N/A").kind).toBe("text");
  expect(parseCell("1,23").kind).toBe("text");
  expect(num("0.5")).toEqual({ v: 0.5, f: "0.0" });
});

test("empty cells are blank", () => {
  expect(parseCell("  ").kind).toBe("blank");
});

test("unambiguous dates become Excel dates", () => {
  expect(parseCell("2026-03-03")).toEqual({ kind: "date", value: 46084, fmt: "yyyy-mm-dd" });
  expect(parseCell("3 March 2026")).toEqual({ kind: "date", value: 46084, fmt: "d mmmm yyyy" });
  expect(parseCell("March 3, 2026")).toEqual({ kind: "date", value: 46084, fmt: "mmmm d, yyyy" });
  expect(parseCell("Mar 3, 2026")).toEqual({ kind: "date", value: 46084, fmt: "mmm d, yyyy" });
  expect(parseCell("31 Feb 2026").kind).toBe("text");
});

test("slash dates are decided by the whole column", () => {
  const mdy = typeColumn(["06/01/2026", "06/29/2026", "06/02/2026"]);
  expect(mdy.map((c) => c.kind)).toEqual(["date", "date", "date"]);
  expect(mdy[0]).toEqual({ kind: "date", value: 46174, fmt: "mm/dd/yyyy" });
  const dmy = typeColumn(["01/06/2026", "29/06/2026"]);
  expect(dmy[0]).toEqual({ kind: "date", value: 46174, fmt: "dd/mm/yyyy" });
  const unsure = typeColumn(["03/04/2026", "05/06/2026"]);
  expect(unsure.map((c) => c.kind)).toEqual(["text", "text"]);
});

test("columns named like identifiers stay text", () => {
  expect(typeColumn(["97205", "97301"], "ZIP").every((c) => c.kind === "text")).toBe(true);
  expect(typeColumn(["97205"], "Amount")[0].kind).toBe("number");
});
