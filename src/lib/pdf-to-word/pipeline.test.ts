import { expect, test } from "bun:test";
import JSZip from "jszip";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { makePng, makeSamplePdf } from "./fixture";
import { convertPdf, type ConvertDeps } from "./index";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;

const deps: ConvertDeps = {
  OPS: OPS as unknown as Record<string, number>,
  rasterizeImage: async () => ({ data: makePng(6, 4, [10, 120, 200]), mime: "image/png" }),
};

async function convert(data: Uint8Array, mode: "editable" | "exact" = "editable", extra: Partial<ConvertDeps> = {}) {
  const pdf = await getDocument({
    data,
    fontExtraProperties: true,
    standardFontDataUrl: FONTS,
  }).promise;
  const progress: number[] = [];
  const result = await convertPdf(
    pdf as never,
    "Sample",
    { mode, language: "eng" },
    { ...deps, ...extra },
    (r) => progress.push(r),
  );
  const zip = await JSZip.loadAsync(result.bytes);
  return { result, zip, xml: await zip.file("word/document.xml")!.async("string"), progress };
}

const textOf = (xml: string) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]);

test("sample PDF converts to a docx with everything in reading order", async () => {
  const { xml, zip, progress } = await convert(await makeSamplePdf());
  const text = textOf(xml);
  const at = (s: string) => text.findIndex((t) => t.includes(s));

  const order = [
    "Quarterly Report",
    "The quick brown fox",
    "A second paragraph",
    "First bullet item",
    "Open the file",
    "Item",
    "Pears",
    "Closing line",
    "Appendix",
  ].map(at);
  expect(order.every((i) => i >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  // heading style, merged paragraphs
  expect(xml).toContain('<w:pStyle w:val="Heading1"/>');
  const paras = xml.split("</w:p>").map((p) => textOf(p).join(""));
  expect(paras.some((p) => p.startsWith("The quick brown fox") && p.includes("violet."))).toBe(true);
  expect(paras.some((p) => p.startsWith("A second paragraph") && p.includes("single flowing paragraph."))).toBe(true);

  // lists
  expect(xml).toContain("<w:numPr>");
  const numbering = await zip.file("word/numbering.xml")!.async("string");
  expect(numbering).toContain('w:numFmt w:val="bullet"');
  expect(numbering).toContain('w:numFmt w:val="decimal"');
  expect(paras.some((p) => p === "First bullet item")).toBe(true);

  // 3x3 ruled table
  expect(xml.match(/<w:tbl>/g)?.length).toBe(1);
  expect(xml.match(/<w:tr>/g)?.length).toBe(3);
  expect(xml.match(/<w:tc>/g)?.length).toBe(9);
  expect(xml).toContain('w:val="single"');

  // image + two sections
  expect(xml).toContain("<wp:inline");
  expect(zip.file("word/media/image1.png")).not.toBeNull();
  expect(xml.match(/<w:sectPr/g)?.length).toBe(2);
  expect(xml.indexOf("<wp:inline")).toBeGreaterThan(xml.indexOf("</w:tbl>"));
  expect(xml.indexOf("<wp:inline")).toBeLessThan(xml.indexOf("Closing line"));

  // bold + italic from the fonts
  expect(xml).toContain("<w:b/>");
  expect(xml).toContain("<w:i/>");
  expect(progress[progress.length - 1]).toBeGreaterThan(0.9);
});

test("exact mode puts one page-sized picture per page", async () => {
  const { xml, zip } = await convert(await makeSamplePdf(), "exact", {
    renderJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  });
  expect(xml.match(/<wp:inline/g)?.length).toBe(2);
  expect(xml.match(/<w:sectPr/g)?.length).toBe(2);
  expect(xml).toContain('w:w="12240" w:h="15840"');
  expect(zip.file("word/media/image1.jpeg")).not.toBeNull();
});

test("a page without a text layer is read with OCR and flows like text", async () => {
  const { PDFDocument } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  page.drawImage(await doc.embedPng(makePng(30, 30, [250, 250, 250])), { x: 0, y: 0, width: 612, height: 792 });
  const { xml, result } = await convert(await doc.save(), "editable", {
    readScan: async () => [
      { str: "Scanned", x: 72, y: 100, w: 60, size: 12, font: "Arial", bold: false, italic: false },
      { str: "words here", x: 140, y: 100, w: 70, size: 12, font: "Arial", bold: false, italic: false },
    ],
  });
  expect(textOf(xml).join("")).toContain("Scanned words here");
  expect(xml).not.toContain("<wp:inline");
  expect(result.notes.join(" ")).toContain("OCR");
});
