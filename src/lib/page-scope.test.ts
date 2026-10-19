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
    { ...initialOptions("rotate"), degrees: 90, ...patch } as never,
  );
  const doc = await PDFDocument.load(await result.blob.arrayBuffer());
  return doc.getPages().map((page) => page.getRotation().angle);
}

test("rotate turns every page by default", async () => {
  expect(await rotations({})).toEqual([180, 90, 90, 90]);
  expect(await rotations({ range: "all" })).toEqual([180, 90, 90, 90]);
});

test("per-page turns add to the page range turn", async () => {
  expect(await rotations({ degrees: 0, perPage: { 1: 90, 3: 270 } })).toEqual([90, 90, 0, 270]);
  expect(await rotations({ range: "1", perPage: { 0: 180, 2: 90 } })).toEqual([0, 0, 90, 0]);
});

test("rotate with nothing to turn says so", async () => {
  await expect(rotations({ degrees: 0 })).rejects.toThrow(/turn/i);
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
  expect(initialOptions("pdf-image")).toMatchObject({
    kind: "pdf-image",
    dpi: 150,
    range: "",
  });
});

test("mirror alone keeps the turn and flips only the listed pages", async () => {
  const [result] = await processRotatePdf(
    [await pdfItem(3)],
    () => {},
    { ...initialOptions("rotate"), degrees: 0, flip: "h", range: "2" } as never,
  );
  expect(result.name).toBe("doc-flipped.pdf");
  const doc = await PDFDocument.load(await result.blob.arrayBuffer());
  expect(doc.getPages().map((p) => p.getRotation().angle)).toEqual([90, 0, 0]);
  const { pageContentText } = await import("./page-ops");
  expect(doc.getPages().map((p) => pageContentText(p).includes(" cm"))).toEqual([
    false,
    true,
    false,
  ]);
});

import { processCropPdf } from "./extra-processors";

async function cropBoxes(patch: Record<string, unknown>) {
  const [result] = await processCropPdf(
    [await pdfItem(3)],
    () => {},
    { ...initialOptions("crop"), ...patch } as never,
  );
  const doc = await PDFDocument.load(await result.blob.arrayBuffer());
  return doc.getPages().map((p) => p.getCropBox().width);
}

test("crop with nothing changed refuses instead of trimming", async () => {
  await expect(cropBoxes({})).rejects.toThrow(/nothing/i);
  await expect(cropBoxes({ applyAll: false })).rejects.toThrow(/nothing/i);
});

test("per-page crop leaves untouched pages alone", async () => {
  const widths = await cropBoxes({
    applyAll: false,
    perPage: { 1: { x: 0.1, y: 0, w: 0.5, h: 1 } },
  });
  expect(widths).toEqual([400, 200, 400]);
});

test("a shared crop applies to every page", async () => {
  expect(await cropBoxes({ box: { x: 0, y: 0, w: 0.5, h: 1 } })).toEqual([400, 200, 200]);
});
