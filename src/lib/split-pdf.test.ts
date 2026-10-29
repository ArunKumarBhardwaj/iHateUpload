import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";

import type { FileItem } from "./job";
import { processExtractPages, processSplitPdf } from "./processors";
import { planSplitGroups } from "./split-groups";
import {
  formatPageList,
  initialOptions,
  optionsReady,
  parsePageRange,
  parseRangeGroups,
} from "./tool-options";

async function pdfItem(pages: number, name = "doc.pdf"): Promise<FileItem> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([200 + i, 300]);
  const bytes = await doc.save();
  const file = new File([bytes], name, { type: "application/pdf" });
  return { id: "a", name, size: file.size, file };
}

async function widths(blob: Blob) {
  const doc = await PDFDocument.load(await blob.arrayBuffer());
  return doc.getPages().map((page) => Math.round(page.getWidth()));
}

const split = (
  item: FileItem,
  patch: Record<string, unknown>,
) =>
  processSplitPdf([item], () => {}, {
    ...initialOptions("split"),
    ...patch,
  } as never);

test("split defaults to one file per page", async () => {
  const results = await split(await pdfItem(3), {});
  expect(results.length).toBe(3);
  expect(await widths(results[1].blob)).toEqual([201]);
});

test("range groups keep each comma part separate and allow open ends", () => {
  expect(parseRangeGroups("1-3, 4-6, 7-", 8)).toEqual([
    [0, 1, 2],
    [3, 4, 5],
    [6, 7],
  ]);
  expect(parseRangeGroups("2, 9, x", 5)).toEqual([[1]]);
});

test("split by ranges makes one file per range", async () => {
  const results = await split(await pdfItem(8), {
    mode: "ranges",
    ranges: "1-3, 4-6, 7-",
  });
  expect(results.length).toBe(3);
  expect(await widths(results[0].blob)).toEqual([200, 201, 202]);
  expect(await widths(results[2].blob)).toEqual([206, 207]);
});

test("split by ranges needs a valid range", async () => {
  const options = { ...initialOptions("split"), mode: "ranges", ranges: "" };
  expect(optionsReady(options as never, "")).toBe(false);
  await expect(
    split(await pdfItem(3), { mode: "ranges", ranges: "40" }),
  ).rejects.toThrow();
});

test("split in half gives two files", async () => {
  const results = await split(await pdfItem(5), { mode: "half" });
  expect(results.length).toBe(2);
  expect(await widths(results[0].blob)).toEqual([200, 201, 202]);
  expect(await widths(results[1].blob)).toEqual([203, 204]);
  await expect(split(await pdfItem(1), { mode: "half" })).rejects.toThrow();
});

test("split by size keeps every part under the limit and flags oversize pages", async () => {
  // Pages with incompressible-ish content so sizes are meaningful.
  const doc = await PDFDocument.create();
  for (let i = 0; i < 6; i++) {
    const page = doc.addPage([300, 300]);
    let text = "";
    for (let k = 0; k < 400; k++) text += Math.random().toString(36).slice(2);
    page.drawText(text.slice(0, 3000), { size: 4, maxWidth: 280, x: 10, y: 290 });
  }
  const bytes = await doc.save();
  const file = new File([bytes], "big.pdf", { type: "application/pdf" });
  const item: FileItem = { id: "b", name: "big.pdf", size: file.size, file };

  const one = await split(item, { mode: "pages" });
  const pageBytes = one[0].size;
  const maxMb = (pageBytes * 2.5) / 1_000_000;
  const results = await split(item, { mode: "size", maxMb });
  expect(results.length).toBeGreaterThan(1);
  expect(results.length).toBeLessThan(6);
  for (const result of results) expect(result.size).toBeLessThanOrEqual(maxMb * 1_000_000);
  let total = 0;
  for (const result of results) total += (await widths(result.blob)).length;
  expect(total).toBe(6);

  const tiny = await split(item, { mode: "size", maxMb: pageBytes / 4_000_000 });
  expect(tiny.length).toBe(6);
  expect(tiny.every((result) => result.note?.includes("over"))).toBe(true);
});

test("page text tolerates spaces round dashes, en dashes and ranges past the end", () => {
  expect(parsePageRange("1 - 3", 10)).toEqual([0, 1, 2]);
  expect(parsePageRange("1–3", 10)).toEqual([0, 1, 2]);
  expect(parsePageRange("2 to 4", 10)).toEqual([1, 2, 3]);
  expect(parsePageRange("8-12", 10)).toEqual([7, 8, 9]);
  expect(parsePageRange("-2, 9 -", 10)).toEqual([0, 1, 8, 9]);
  expect(parsePageRange("11-12", 10)).toEqual([]);
  expect(parseRangeGroups("1 - 3, 4 - 6", 10)).toEqual([
    [0, 1, 2],
    [3, 4, 5],
  ]);
  expect(formatPageList([1, 4, 5, 6, 9])).toBe("2, 5-7, 10");
});

test("fixed ranges make a file every N pages", async () => {
  const results = await split(await pdfItem(7), { mode: "fixed", everyN: 3 });
  expect(results.map((r) => r.name)).toEqual([
    "doc-pages-1-3.pdf",
    "doc-pages-4-6.pdf",
    "doc-pages-7.pdf",
  ]);
  expect(await widths(results[2].blob)).toEqual([206]);
});

test("merge all ranges puts every range into one PDF in the order typed", async () => {
  const results = await split(await pdfItem(8), {
    mode: "ranges",
    ranges: "6-7, 1-2",
    merge: true,
  });
  expect(results.length).toBe(1);
  expect(await widths(results[0].blob)).toEqual([205, 206, 200, 201]);
});

test("select pages gives one file per page, or one merged file", async () => {
  const item = await pdfItem(8);
  const separate = await split(item, { mode: "select", pick: "2, 5-6" });
  expect(separate.map((r) => r.name)).toEqual([
    "doc-page-2.pdf",
    "doc-page-5.pdf",
    "doc-page-6.pdf",
  ]);
  const merged = await split(item, { mode: "select", pick: "2, 5-6", merge: true });
  expect(merged.length).toBe(1);
  expect(await widths(merged[0].blob)).toEqual([201, 204, 205]);
  const options = { ...initialOptions("split"), mode: "select", pick: "" };
  expect(optionsReady(options as never, "")).toBe(false);
});

test("the preview plan and the files agree", async () => {
  const options = { ...initialOptions("split"), mode: "ranges", ranges: "1-3, 8-12" } as never;
  const plan = planSplitGroups(options, 10, "doc");
  expect(plan.ok && plan.groups.map((g) => g.pages.length)).toEqual([3, 3]);
  const results = await processSplitPdf([await pdfItem(10)], () => {}, options);
  expect(results.length).toBe(2);
});

test("extract pages can save each page as its own PDF", async () => {
  const item = await pdfItem(5);
  const one = await processExtractPages([item], () => {}, {
    kind: "extract",
    range: "4, 2",
    pageCount: 5,
  });
  expect(one.length).toBe(1);
  expect(await widths(one[0].blob)).toEqual([201, 203]);
  const each = await processExtractPages([item], () => {}, {
    kind: "extract",
    range: "2, 4",
    pageCount: 5,
    separate: true,
  });
  expect(each.map((r) => r.name)).toEqual(["doc-page-2.pdf", "doc-page-4.pdf"]);
});
