import { expect, test } from "bun:test";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import * as XLSX from "xlsx";

import { BANK_STYLES, makeBankStatement } from "./bank-fixtures";
import { scoreStatement } from "./bank-score";
import { convertPdfToExcel } from "./index";
import { amountOf, checkBalances, roleOf } from "./statement";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;

async function convert(bytes: Uint8Array, layout: "tables" | "pages" = "tables") {
  const pdf = await getDocument({ data: bytes.slice(), fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const result = await convertPdfToExcel(
    pdf as never,
    "Statement",
    { layout, includeText: true, language: "eng", range: "" },
    { OPS: OPS as unknown as Record<string, number> },
    () => {},
  );
  return { result, wb: XLSX.read(result.bytes, { cellNF: true, cellStyles: true }) };
}

for (const style of BANK_STYLES) {
  test(`${style}-style statement: every transaction on one row, typed, balances add up`, async () => {
    const { bytes, truth } = await makeBankStatement(style);
    const { wb, result } = await convert(bytes);
    expect(wb.SheetNames[0]).toBe("Transactions");
    const score = scoreStatement(wb, truth, XLSX);
    expect(score.misses).toEqual([]);
    expect(score.exact).toBe(truth.txns.length);
    expect(score.extra).toBe(0);
    expect(result.notes.join(" ")).toContain("Every running balance adds up");
    const ws = wb.Sheets.Transactions;
    // A real date, a real amount, the header frozen.
    const dates = ["A", "B", "C"].flatMap((c) => [2, 3].map((r) => ws[`${c}${r}`])).filter((cell) => cell?.t === "n" && cell.v > 45000);
    expect(dates.length).toBeGreaterThan(0);
    expect(ws["!autofilter"]).toBeDefined();
  });
}

test("one Amount column with Dr/Cr becomes Debit and Credit", async () => {
  const { bytes } = await makeBankStatement("kotak", 12);
  const { wb } = await convert(bytes);
  const head = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Transactions, { header: 1 })[0];
  expect(head).toEqual(["Date", "Narration", "Chq/Ref No", "Debit", "Credit", "Balance"]);
});

test("wrapped narrations cut mid-word are joined without a space", async () => {
  const { bytes, truth } = await makeBankStatement("hdfc", 10);
  const { wb } = await convert(bytes);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Transactions, { header: 1 });
  expect(rows[1][1]).toBe(truth.txns[0].narration);
});

test("reference numbers stay text, so leading zeros survive", async () => {
  const { bytes, truth } = await makeBankStatement("hdfc", 6);
  const { wb } = await convert(bytes);
  const withRef = truth.txns.findIndex((t) => t.ref.startsWith("0"));
  const cell = wb.Sheets.Transactions[`C${withRef + 2}`];
  expect(cell.t).toBe("s");
  expect(cell.v).toBe(truth.txns[withRef].ref);
});

test("one sheet per page still splits the statement by page", async () => {
  const { bytes, truth } = await makeBankStatement("hdfc");
  const { wb } = await convert(bytes, "pages");
  expect(wb.SheetNames.slice(0, truth.pages)).toEqual(Array.from({ length: truth.pages }, (_, i) => `Page ${i + 1}`));
});

test("a balance that does not add up is reported and marked", () => {
  const rows = [
    { debit: 0, credit: 0, balance: 1000 },
    { debit: 100, credit: 0, balance: 900 },
    { debit: 0, credit: 50, balance: 960 },
    { debit: 10, credit: 0, balance: 950 },
  ];
  expect(checkBalances(rows)).toEqual({ checked: 3, failed: [2], direction: "up" });
  // Newest first.
  expect(checkBalances([...rows.slice(0, 2)].reverse().concat([]))).toMatchObject({ failed: [] });
  const newestFirst = [
    { debit: 10, credit: 0, balance: 940 },
    { debit: 0, credit: 50, balance: 950 },
    { debit: 100, credit: 0, balance: 900 },
    { debit: 0, credit: 0, balance: 1000 },
  ];
  expect(checkBalances(newestFirst)).toEqual({ checked: 3, failed: [], direction: "down" });
});

test("amounts: Indian grouping, Cr and Dr, rupee prefixes", () => {
  expect(amountOf("1,23,456.78")).toEqual({ value: 123456.78, side: undefined });
  expect(amountOf("43,959.19(Cr)")).toEqual({ value: 43959.19, side: "cr" });
  expect(amountOf("500.00 Dr")).toEqual({ value: 500, side: "dr" });
  expect(amountOf("Rs. 1,250.00")?.value).toBe(1250);
  expect(amountOf("-")).toBeNull();
  expect(amountOf("NEFT")).toBeNull();
});

test("header words map to column roles", () => {
  expect(roleOf("Withdrawal Amt.")).toBe("debit");
  expect(roleOf("Deposit Amount (INR )")).toBe("credit");
  expect(roleOf("Closing Balance")).toBe("balance");
  expect(roleOf("Value Dt")).toBe("valueDate");
  expect(roleOf("Txn Date")).toBe("date");
  expect(roleOf("Chq./Ref.No.")).toBe("ref");
  expect(roleOf("Transaction Remarks")).toBe("narration");
  expect(roleOf("Particulars")).toBe("narration");
  expect(roleOf("Dr / Cr")).toBe("drcr");
  expect(roleOf("Amount")).toBe("amount");
  expect(roleOf("S No.")).toBe("serial");
});

test("an invoice with Date, Description and Amount is not read as a statement", async () => {
  const { PDFDocument, StandardFonts } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  const rows = [["Date", "Description", "Qty", "Amount"], ...Array.from({ length: 6 }, (_, i) => [`0${i + 1}/04/2024`, `Item ${i + 1}`, String(i + 2), `${(i + 1) * 120}.00`])];
  rows.forEach((r, k) => r.forEach((t, c) => page.drawText(t, { x: 40 + c * 120, y: 760 - k * 16, size: 9, font })));
  const { wb, result } = await convert(await doc.save());
  expect(wb.SheetNames).not.toContain("Transactions");
  expect(result.notes.join(" ")).not.toContain("Bank statement");
});
