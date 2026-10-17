import { expect, test } from "bun:test";

import type { FileItem } from "./job";
import { textPdf, type OutlineSpec } from "./pdf-fixtures";
import { processSplitPdf } from "./processors";
import {
  planByBookmarks,
  planByText,
  readOutline,
  readPageTexts,
  sanitizeFileName,
} from "./split-plan";
import { initialOptions, optionsReady } from "./tool-options";

const BODY = Array.from({ length: 12 }, (_, i) =>
  i === 4
    ? "CHAPTER Two begins here"
    : i === 8
      ? "Chapter Three: the end"
      : `Body page ${i + 1}`,
);
const OUTLINE: OutlineSpec[] = [
  {
    title: "Intro / Overview: Part?",
    page: 0,
    children: [
      { title: "Background", page: 1 },
      { title: "Scope", page: 2 },
    ],
  },
  {
    title: "Chapter Two",
    page: 4,
    children: [
      { title: "Detail A", page: 5, children: [{ title: "Deep", page: 6 }] },
      { title: "Detail B", page: 7 },
    ],
  },
  { title: "Chapter Three", page: 8 },
];

async function textItem(texts: string[], outline?: OutlineSpec[], name = "book.pdf") {
  const file = new File([await textPdf(texts, outline)], name, {
    type: "application/pdf",
  });
  return { id: "t", name, size: file.size, file } as FileItem;
}

const split = (item: FileItem, patch: Record<string, unknown>) =>
  processSplitPdf([item], () => {}, {
    ...initialOptions("split"),
    ...patch,
  } as never);

async function pageTexts(blob: Blob) {
  return readPageTexts(new Uint8Array(await blob.arrayBuffer()));
}

test("outline reader returns titles, pages and depth in order", async () => {
  const item = await textItem(BODY, OUTLINE);
  const items = await readOutline(new Uint8Array(await item.file.arrayBuffer()));
  expect(items.map((i) => [i.title, i.page, i.depth])).toEqual([
    ["Intro / Overview: Part?", 0, 1],
    ["Background", 1, 2],
    ["Scope", 2, 2],
    ["Chapter Two", 4, 1],
    ["Detail A", 5, 2],
    ["Deep", 6, 3],
    ["Detail B", 7, 2],
    ["Chapter Three", 8, 1],
  ]);
});

test("a PDF with no outline reads as empty", async () => {
  const item = await textItem(BODY);
  expect(await readOutline(new Uint8Array(await item.file.arrayBuffer()))).toEqual([]);
});

test("file names from bookmark titles are made safe", () => {
  expect(sanitizeFileName("Intro / Overview: Part?")).toBe("Intro - Overview- Part");
  expect(sanitizeFileName('  ..a<b>c|d*e"f\\g  ')).toBe("a-b-c-d-e-f-g");
  expect(sanitizeFileName("???")).toBe("untitled");
  expect(sanitizeFileName("x".repeat(200)).length).toBe(80);
  expect(sanitizeFileName("CON")).toBe("CON-");
});

test("split by bookmarks cuts at top-level items", async () => {
  const results = await split(await textItem(BODY, OUTLINE), { mode: "bookmarks" });
  expect(results.map((r) => r.name)).toEqual([
    "book-01-Intro - Overview- Part.pdf",
    "book-02-Chapter Two.pdf",
    "book-03-Chapter Three.pdf",
  ]);
  expect(results.map((r) => r.note)).toEqual(["Pages 1-4", "Pages 5-8", "Pages 9-12"]);
  const texts = await pageTexts(results[1].blob);
  expect(texts.length).toBe(4);
  expect(texts[0]).toContain("CHAPTER Two");
});

test("pages before the first bookmark become front matter", async () => {
  const late: OutlineSpec[] = [
    { title: "Chapter A", page: 2 },
    { title: "Chapter B", page: 5 },
  ];
  const results = await split(await textItem(BODY, late), { mode: "bookmarks" });
  expect(results.map((r) => r.note)).toEqual(["Pages 1-2", "Pages 3-5", "Pages 6-12"]);
  expect(results[0].name).toBe("book-01-Front matter.pdf");
});

test("bookmark depth 2 also cuts at nested items", async () => {
  const results = await split(await textItem(BODY, OUTLINE), {
    mode: "bookmarks",
    bookmarkDepth: 2,
  });
  expect(results.map((r) => r.note)).toEqual([
    "Page 1", "Page 2", "Pages 3-4", "Page 5", "Pages 6-7", "Page 8", "Pages 9-12",
  ]);
});

test("bookmarks switched off merge into the part before", async () => {
  const results = await split(await textItem(BODY, OUTLINE), {
    mode: "bookmarks",
    bookmarkOff: [1],
  });
  expect(results.map((r) => r.note)).toEqual(["Pages 1-8", "Pages 9-12"]);
});

test("split by bookmarks says so when the PDF has none", async () => {
  await expect(split(await textItem(BODY), { mode: "bookmarks" })).rejects.toThrow(
    /bookmarks/i,
  );
});

test("bookmark plan sorts by page and keeps one item per page", () => {
  const parts = planByBookmarks(
    [
      { title: "B", page: 5, depth: 1 },
      { title: "A", page: 0, depth: 1 },
      { title: "A child", page: 0, depth: 2 },
    ],
    8,
    2,
    "f",
    [],
  );
  expect(parts.map((p) => [p.name, p.start, p.end])).toEqual([
    ["f-01-A", 0, 4],
    ["f-02-B", 5, 7],
  ]);
});

// --- by text ---------------------------------------------------------------

const texts = ["Invoice 100", "page two", "INVOICE 101 total", "x", "invoice 102"];

test("text plan splits before each match, case-insensitive by default", () => {
  const plan = planByText(texts, { phrase: "invoice", regex: false, matchCase: false, wholeWord: false }, "inv");
  if (!plan.ok) throw new Error(plan.error);
  expect(plan.parts.map((p) => [p.start, p.end])).toEqual([[0, 1], [2, 3], [4, 4]]);
  expect(plan.parts.map((p) => p.name)).toEqual(["inv-01-Invoice", "inv-02-INVOICE", "inv-03-invoice"]);
});

test("text plan keeps leading pages that precede the first match", () => {
  const plan = planByText(["cover", "A one", "b", "A two"], { phrase: "A ", regex: false, matchCase: true, wholeWord: false }, "f");
  if (!plan.ok) throw new Error(plan.error);
  expect(plan.parts.map((p) => [p.start, p.end])).toEqual([[0, 0], [1, 2], [3, 3]]);
  expect(plan.parts[0].name).toBe("f-01-Front matter");
});

test("text plan supports regex, match case and whole word", () => {
  const regex = planByText(texts, { phrase: "invoice\\s+10[12]", regex: true, matchCase: false, wholeWord: false }, "f");
  if (!regex.ok) throw new Error(regex.error);
  expect(regex.parts.map((p) => [p.start, p.end])).toEqual([[0, 1], [2, 3], [4, 4]]);
  // Names carry the matched text, so an invoice number can title each file.
  expect(regex.parts.map((p) => p.name)).toEqual(["f-01-Front matter", "f-02-INVOICE 101", "f-03-invoice 102"]);

  const cased = planByText(texts, { phrase: "Invoice", regex: false, matchCase: true, wholeWord: false }, "f");
  if (!cased.ok) throw new Error(cased.error);
  expect(cased.parts.map((p) => [p.start, p.end])).toEqual([[0, 4]]);

  const word = planByText(["a cat", "concatenate", "cat again"], { phrase: "cat", regex: false, matchCase: false, wholeWord: true }, "f");
  if (!word.ok) throw new Error(word.error);
  expect(word.parts.map((p) => [p.start, p.end])).toEqual([[0, 1], [2, 2]]);
});

test("text plan reports bad regex and no match", () => {
  const bad = planByText(texts, { phrase: "(", regex: true, matchCase: false, wholeWord: false }, "f");
  expect(bad.ok).toBe(false);
  const none = planByText(texts, { phrase: "zebra", regex: false, matchCase: false, wholeWord: false }, "f");
  expect(none.ok).toBe(false);
  if (!none.ok) expect(none.error).toMatch(/zebra/);
});

test("text plan matches phrases that wrap across lines", () => {
  const plan = planByText(["a\nStatement of\nAccount x"], { phrase: "statement of account", regex: false, matchCase: false, wholeWord: false }, "f");
  expect(plan.ok).toBe(true);
});

test("split by text cuts a real PDF at the matching pages", async () => {
  const item = await textItem(texts);
  const results = await split(item, { mode: "text", phrase: "invoice" });
  expect(results.length).toBe(3);
  expect(results.map((r) => r.note)).toEqual(["Pages 1-2", "Pages 3-4", "Page 5"]);
  const got = await pageTexts(results[1].blob);
  expect(got[0]).toContain("INVOICE 101");
});

test("split by text and bookmarks need their inputs before they are ready", () => {
  expect(optionsReady({ ...initialOptions("split"), mode: "text", phrase: "" } as never, "")).toBe(false);
  expect(optionsReady({ ...initialOptions("split"), mode: "text", phrase: "x" } as never, "")).toBe(true);
  expect(optionsReady({ ...initialOptions("split"), mode: "bookmarks" } as never, "")).toBe(true);
});
