import { expect, test } from "bun:test";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";

import type { FileItem } from "./job";
import { dpiScale, processRotatePdf } from "./processors";
import { initialOptions, resolvePageRange } from "./tool-options";

async function pdfItem(pages: number): Promise<FileItem> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([400, 500]);
  doc.getPage(0).setRotation(degrees(90));
  const file = new File([await doc.save()], "doc.pdf", {
    type: "application/pdf",
  });
  return { id: "a", name: "doc.pdf", size: file.size, file };
}

async function rotations(patch: Record<string, unknown>, pages = 4) {
  const [result] = await processRotatePdf(
    [await pdfItem(pages)],
    () => {},
    { ...initialOptions("rotate"), ...patch } as never,
  );
  const doc = await PDFDocument.load(await result.blob.arrayBuffer());
  return doc.getPages().map((page) => page.getRotation().angle);
}

test("rotate turns every page by default", async () => {
  expect(await rotations({})).toEqual([180, 90, 90, 90]);
  expect(await rotations({ range: "all" })).toEqual([180, 90, 90, 90]);
});

test("rotate only turns the listed pages", async () => {
  expect(await rotations({ range: "2-3" })).toEqual([90, 90, 90, 0]);
  expect(await rotations({ range: "1, 4" })).toEqual([180, 0, 0, 90]);
  expect(await rotations({ range: "3-" })).toEqual([90, 0, 90, 90]);
});

test("rotate rejects a range with no valid pages", async () => {
  await expect(rotations({ range: "9" })).rejects.toThrow();
});

test("page range resolves blank to all pages and rejects nonsense", () => {
  expect(resolvePageRange("", 3)).toEqual([0, 1, 2]);
  expect(resolvePageRange("2-3", 3)).toEqual([1, 2]);
  expect(() => resolvePageRange("7", 3)).toThrow();
});

test("dpi maps onto pdf.js scale, 144 keeping the old 2x", () => {
  expect(dpiScale(72)).toBe(1);
  expect(dpiScale(144)).toBe(2);
  expect(dpiScale(300)).toBeCloseTo(4.1667, 3);
  expect(initialOptions("pdf-image")).toEqual({
    kind: "pdf-image",
    dpi: 144,
    range: "",
  });
});
