import { expect, test } from "bun:test";

import { docLabel, findDocuments, linesFromItems, maybeCuts, pageIds, pageMark, smartDocs, type PageInfo, type PageLine } from "./detect";

const L = (text: string, y: number, size = 11, x = 0.1): PageLine => ({ text, y, size, x });
const page = (lines: PageLine[], extra: Partial<PageInfo> = {}): PageInfo => ({ lines, width: 612, height: 792, blank: false, ...extra });
const body = (words: string, from = 0.3, n = 8) => Array.from({ length: n }, (_, i) => L(`${words} line ${i + 1} of the body text goes on here.`, from + i * 0.05));

test("page numbers are read from the head or foot, in several languages", () => {
  expect(pageMark([L("Page 2 of 5", 0.95)])).toEqual({ n: 2, of: 5 });
  expect(pageMark([L("Página 1 de 3", 0.95)])).toEqual({ n: 1, of: 3 });
  expect(pageMark([L("3/4", 0.04)])).toEqual({ n: 3, of: 4 });
  expect(pageMark([L("- 7 -", 0.96)])).toEqual({ n: 7 });
  expect(pageMark([L("Page 2 of 5", 0.5)])).toBeNull();
});

test("reference numbers are picked up with their labels", () => {
  const ids = pageIds([L("Invoice No: HP-1001", 0.1), L("Account number 4417-2290", 0.2), L("Ref: 12", 0.3)]);
  expect(ids.get("invoice")).toBe("HP-1001");
  expect(ids.get("account")).toBe("4417-2290");
  expect(ids.has("reference")).toBe(false);
});

test("a stack of an invoice, a two-page letter and a statement is cut in three", () => {
  const pages = [
    page([L("INVOICE", 0.1, 22), L("Invoice No: A-100", 0.15), ...body("Items")]),
    page([L("Halvorsen & Pike Architects", 0.06, 15), L("Dear Ms. Moreno,", 0.3), ...body("Letter", 0.35)]),
    page([L("continued from the page before, the roof work will", 0.1), ...body("letter")]),
    page([L("Statement of Account", 0.1, 16), ...body("Rows"), L("Page 1 of 2", 0.95)]),
    page([...body("More rows"), L("Page 2 of 2", 0.95)]),
  ];
  const plan = findDocuments(pages);
  expect(plan.starts.map((s) => s.page)).toEqual([0, 1, 3]);
  expect(plan.starts[2].reasons).toContain("says page 1 of 2");
  expect(plan.starts[1].reasons).toContain("letter greeting");
});

test("two invoices from one supplier are told apart by number; a continued page is not", () => {
  const head = [L("Harbor & Pine Office Supply", 0.04, 14), L("22 Wharf Lane", 0.06, 9)];
  const foot = [L("Harbor & Pine Office Supply - VAT GB 284", 0.95, 8)];
  const pages = [
    page([...head, L("INVOICE", 0.12, 22), L("Invoice No: HP-1001", 0.16), ...body("A"), ...foot]),
    page([...head, L("Invoice HP-1001 (continued)", 0.12, 12), ...body("A2"), ...foot]),
    page([...head, L("INVOICE", 0.12, 22), L("Invoice No: HP-1002", 0.16), ...body("B"), ...foot]),
  ];
  expect(findDocuments(pages).starts.map((s) => s.page)).toEqual([0, 2]);
});

test("blank sheets separate documents and are left out; near misses can be switched on", () => {
  const pages = [
    page([L("Report", 0.1, 11), ...body("A")]),
    page([], { blank: true }),
    page([L("Notes", 0.1, 11), ...body("B")]),
    page([...body("C")]),
  ];
  const plan = findDocuments(pages);
  expect(plan.blanks).toEqual([1]);
  expect(plan.starts.map((s) => s.page)).toEqual([0]);
  const near = maybeCuts(plan);
  expect(near[0].page).toBe(2);
  expect(smartDocs(plan, pages, { off: [], on: [], dropBlank: true }).map((d) => d.pages)).toEqual([[0, 2, 3]]);
  expect(smartDocs(plan, pages, { off: [], on: [2], dropBlank: true }).map((d) => d.pages)).toEqual([[0], [2, 3]]);
  expect(smartDocs(plan, pages, { off: [], on: [2], dropBlank: false }).map((d) => d.pages)).toEqual([[0, 1], [2, 3]]);
});

test("a cut switched off joins the document to the one before", () => {
  const pages = [page([L("INVOICE", 0.1, 22), ...body("A")]), page([L("RECEIPT", 0.1, 22), ...body("B")], { width: 227, height: 539 })];
  const plan = findDocuments(pages);
  expect(plan.starts.length).toBe(2);
  expect(smartDocs(plan, pages, { off: [1], on: [], dropBlank: true }).map((d) => d.pages)).toEqual([[0, 1]]);
});

test("a scanned page after typed ones is a different source; a one-line spill-over page is not a new document", () => {
  const typed = page([L("Memo", 0.1, 11), ...body("A")]);
  expect(findDocuments([typed, page([L("Dear Sir,", 0.3), ...body("B", 0.35)], { scanned: true })]).starts.length).toBe(2);
  expect(findDocuments([page([...body("A"), L("Sincerely,", 0.84)]), page([L("Principal Architect", 0.07)])]).starts.length).toBe(1);
});

test("documents are named from their title and reference number", () => {
  expect(docLabel(page([L("INVOICE", 0.1, 22), L("Invoice No: HP-1002", 0.16), ...body("x")]))).toBe("INVOICE HP-1002");
  expect(docLabel(page([L("Quarterly Report", 0.1, 20), ...body("x")]))).toBe("Quarterly Report");
});

test("text items become lines, top to bottom, left to right", () => {
  const lines = linesFromItems(
    [
      { str: "World", x: 200, y: 100, size: 12 },
      { str: "Hello", x: 100, y: 101, size: 12 },
      { str: "Next", x: 100, y: 130, size: 10 },
    ],
    792,
    612,
  );
  expect(lines.map((l) => l.text)).toEqual(["Hello World", "Next"]);
  expect(lines[0].x).toBeCloseTo(100 / 612);
});
