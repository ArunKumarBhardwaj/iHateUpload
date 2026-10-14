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

test("links, bookmarks, outline headings and document properties survive conversion", async () => {
  const { makeLinkedPdf } = await import("./fixture");
  const { xml, zip } = await convert(await makeLinkedPdf());
  const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
  expect(xml).toMatch(/<w:hyperlink r:id="rId\d+" w:history="1">.*?>manual<\/w:t>/);
  expect(rels).toContain('Target="https://example.com/manual" TargetMode="External"');
  const anchor = /<w:hyperlink w:anchor="([^"]+)" w:history="1">.*?>details page<\/w:t>/.exec(xml)?.[1];
  expect(anchor).toBeDefined();
  expect(xml).toContain(`w:name="${anchor}"/>`);
  // The outline makes "Details" a Heading 1 and "More" a Heading 2.
  expect(xml).toMatch(/w:val="Heading1"\/>.*?>Details</);
  expect(xml).toMatch(/w:val="Heading2"\/>.*?>More</);
  const core = await zip.file("docProps/core.xml")!.async("string");
  expect(core).toContain("<dc:title>Link Sampler</dc:title>");
  expect(core).toContain("<dc:creator>Ada Writer</dc:creator>");
  expect(core).toContain("<dc:subject>Testing links</dc:subject>");
  expect(core).toMatch(/<cp:keywords>alpha.+beta<\/cp:keywords>/);
  expect(core).toContain("2024-03-05T10:20:30Z");
});

test("bullets drawn as dots become real list items, nested by indent", async () => {
  const { makeDotListPdf } = await import("./fixture");
  const { xml, zip } = await convert(await makeDotListPdf());
  const paras = xml.split("<w:p>").slice(1);
  const item = (t: string) => paras.find((p) => p.includes(`>${t}<`))!;
  const lvl = (t: string) => /<w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"/.exec(item(t))!;
  expect(lvl("Copper kettle")[1]).toBe("0");
  expect(lvl("Timber bundles")[1]).toBe("1");
  expect(lvl("Marble anchor")[1]).toBe("0");
  // One list with two levels, so Word keeps the nesting.
  expect(new Set(["Copper kettle", "Timber bundles", "Marble anchor"].map((t) => lvl(t)[2])).size).toBe(1);
  expect(lvl("Open the gate")[2]).not.toBe(lvl("Copper kettle")[2]);
  const numbering = await zip.file("word/numbering.xml")!.async("string");
  expect(numbering).toContain('w:ilvl="1"');
});

test("colour, underline, strike, highlight and raised text reach the docx runs", async () => {
  const { makeFormattedPdf } = await import("./fixture");
  const { xml } = await convert(await makeFormattedPdf());
  const run = (t: string) => new RegExp(`<w:r>(<w:rPr>(?:(?!</w:rPr>).)*</w:rPr>)?<w:t[^>]*>${t}<`).exec(xml)?.[1] ?? "";
  expect(run("red words")).toContain('<w:color w:val="FF0000"/>');
  expect(run("blue")).toContain('<w:color w:val="0000FF"/>');
  expect(run("Colours: ")).not.toContain("w:color");
  expect(run("underlined")).toContain('<w:u w:val="single"/>');
  expect(run("struck")).toContain("<w:strike/>");
  expect(run("highlighted")).toContain('w:fill="FFFF00"');
  expect(run("2")).toContain("w:vertAlign");
  expect(xml).toContain('<w:vertAlign w:val="subscript"/>');
  expect(xml).toContain('<w:vertAlign w:val="superscript"/>');
  // The underline and strike lines were text formatting, not tables.
  expect(xml).not.toContain("<w:tbl>");
});
