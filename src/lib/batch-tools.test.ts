import { expect, test } from "bun:test";
import { PDFDocument } from "@cantoo/pdf-lib";

import type { FileItem } from "./job";
import { batchBaseNames, processCropPdf, redactCategoriesForBatch } from "./extra-processors";
import { textPdf } from "./pdf-fixtures";
import { initialOptions, type RedactFinding } from "./tool-options";

async function item(pages: number, name: string): Promise<FileItem> {
  const bytes = await textPdf(Array.from({ length: pages }, (_, i) => `${name} page ${i + 1}`));
  const file = new File([bytes], name, { type: "application/pdf" });
  return { id: name, name, size: file.size, file };
}

const crop = () => {
  const options = initialOptions("crop");
  if (options.kind !== "crop") throw new Error("crop options");
  return { ...options, box: { pageIndex: 0, x: 0.1, y: 0.1, w: 0.8, h: 0.8 } };
};

test("crop takes several PDFs and crops every page of each", async () => {
  const files = [await item(2, "a.pdf"), await item(3, "b.pdf")];
  const results = await processCropPdf(files, () => {}, crop());
  expect(results.map((r) => r.name)).toEqual(["a-cropped.pdf", "b-cropped.pdf"]);
  for (const [i, r] of results.entries()) {
    const before = await PDFDocument.load(await files[i].file.arrayBuffer());
    const doc = await PDFDocument.load(await r.blob.arrayBuffer());
    expect(doc.getPageCount()).toBe(i === 0 ? 2 : 3);
    doc.getPages().forEach((page, n) => {
      const { width, height } = before.getPage(n).getSize();
      expect(page.getCropBox().width).toBeCloseTo(width * 0.8, 1);
      expect(page.getCropBox().height).toBeCloseTo(height * 0.8, 1);
    });
  }
});

test("per-page crop is for one file and says so", async () => {
  const files = [await item(1, "a.pdf"), await item(1, "b.pdf")];
  const options = { ...crop(), applyAll: false, perPage: { 0: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } } };
  await expect(processCropPdf(files, () => {}, options)).rejects.toThrow(/one PDF at a time/);
});

test("files with the same name get distinct output names", () => {
  expect(batchBaseNames(["scan.pdf", "scan.pdf", "other.pdf", "Scan.PDF"])).toEqual(["scan", "scan-2", "other", "Scan-3"]);
});

test("a batch redacts the kinds of data accepted on the first file", () => {
  const finding = (category: RedactFinding["category"], accepted: boolean): RedactFinding => ({
    id: category + accepted, pageIndex: 0, x: 0, y: 0, w: 0.1, h: 0.1, category, text: "x", accepted,
  });
  const options = initialOptions("redact");
  if (options.kind !== "redact") throw new Error("redact options");
  const picked = redactCategoriesForBatch({ ...options, findings: [finding("email", true), finding("phone", false)] });
  expect([...picked]).toEqual(["email"]);
});
