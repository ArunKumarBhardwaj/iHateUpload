import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";

import type { FileItem } from "./job";
import { processSplitPdf } from "./processors";
import { initialOptions, optionsReady, parseRangeGroups } from "./tool-options";

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
