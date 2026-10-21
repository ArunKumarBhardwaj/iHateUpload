import { expect, test } from "bun:test";
import JSZip from "jszip";
import { PDFDocument } from "@cantoo/pdf-lib";

import { buildPdfZip, DEFAULT_PDF_ZIP, planZipEntries, type PdfZipSettings } from "./pdf-zip";

const S = (over: Partial<PdfZipSettings> = {}): PdfZipSettings => ({ ...DEFAULT_PDF_ZIP, ...over });

async function pdf(widths: number[]) {
  const doc = await PDFDocument.create();
  for (const w of widths) doc.addPage([w, 100]);
  return new Uint8Array(await doc.save());
}

test("whole files keep their own names", () => {
  const plan = planZipEntries([{ name: "a.pdf", pages: 3 }, { name: "b.PDF", pages: 2 }], S());
  expect(plan.map((e) => e.path)).toEqual(["a.pdf", "b.pdf"]);
});

test("duplicate names get a number instead of overwriting", () => {
  const plan = planZipEntries([{ name: "a.pdf", pages: 1 }, { name: "A.pdf", pages: 1 }, { name: "a.pdf", pages: 1 }], S());
  expect(plan.map((e) => e.path)).toEqual(["a.pdf", "A (2).pdf", "a (3).pdf"]);
});

test("one PDF per page with a padded part number", () => {
  const plan = planZipEntries([{ name: "doc.pdf", pages: 10 }], S({ split: 1, template: "{name}-{part}" }));
  expect(plan.length).toBe(10);
  expect(plan[0].path).toBe("doc-01.pdf");
  expect(plan[9].path).toBe("doc-10.pdf");
  expect(plan[9]).toMatchObject({ from: 10, to: 10 });
});

test("every N pages, last part may be shorter, range tokens work", () => {
  const plan = planZipEntries([{ name: "doc.pdf", pages: 5 }], S({ split: 2, template: "{name}_{from}-{to}" }));
  expect(plan.map((e) => e.path)).toEqual(["doc_1-2.pdf", "doc_3-4.pdf", "doc_5-5.pdf"]);
});

test("folder, and a folder per source file", () => {
  const files = [{ name: "a.pdf", pages: 2 }, { name: "b.pdf", pages: 1 }];
  expect(planZipEntries(files, S({ folder: "bundle" })).map((e) => e.path)).toEqual(["bundle/a.pdf", "bundle/b.pdf"]);
  const split = planZipEntries(files, S({ split: 1, template: "p{part}", folder: "out", fileFolders: true }));
  expect(split.map((e) => e.path)).toEqual(["out/a/p1.pdf", "out/a/p2.pdf", "out/b/p1.pdf"]);
});

test("names are made safe: no path tricks, no illegal characters", () => {
  const plan = planZipEntries([{ name: "x.pdf", pages: 1 }], S({ folder: "../evil/..", template: 'a/b:c*"' , split: 1 }));
  for (const e of plan) {
    expect(e.path.includes("..")).toBe(false);
    expect(e.path.startsWith("/")).toBe(false);
    expect(/[:*"<>|\\]/.test(e.path)).toBe(false);
  }
});

test("an empty template falls back to the file name", () => {
  expect(planZipEntries([{ name: "x.pdf", pages: 2 }], S({ split: 1, template: "  " })).map((e) => e.path)).toEqual([
    "x-1.pdf",
    "x-2.pdf",
  ]);
});

test("whole files are stored byte for byte", async () => {
  const a = await pdf([111, 112]);
  const { bytes } = await buildPdfZip([{ name: "a.pdf", bytes: a }], S());
  const zip = await JSZip.loadAsync(bytes);
  const back = await zip.file("a.pdf")!.async("uint8array");
  expect(Buffer.from(back).equals(Buffer.from(a))).toBe(true);
});

test("splitting writes real PDFs with the right pages, in order", async () => {
  const a = await pdf([111, 112, 113]);
  const { bytes, entries } = await buildPdfZip([{ name: "a.pdf", bytes: a }], S({ split: 2, template: "{name}-{part}" }));
  expect(entries).toBe(2);
  const zip = await JSZip.loadAsync(bytes);
  const first = await PDFDocument.load(await zip.file("a-1.pdf")!.async("uint8array"));
  const second = await PDFDocument.load(await zip.file("a-2.pdf")!.async("uint8array"));
  expect(first.getPages().map((p) => p.getWidth())).toEqual([111, 112]);
  expect(second.getPages().map((p) => p.getWidth())).toEqual([113]);
});

test("compression levels: store is larger than max on compressible data", async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 30; i++) doc.addPage([300, 300]).drawText("hello ".repeat(50), { x: 5, y: 150, size: 8 });
  const a = new Uint8Array(await doc.save({ useObjectStreams: false }));
  const store = await buildPdfZip([{ name: "a.pdf", bytes: a }], S({ level: "store" }));
  const max = await buildPdfZip([{ name: "a.pdf", bytes: a }], S({ level: "max" }));
  expect(max.bytes.length).toBeLessThan(store.bytes.length);
});

test("nothing to pack is an error", async () => {
  await expect(buildPdfZip([], S())).rejects.toThrow();
});
