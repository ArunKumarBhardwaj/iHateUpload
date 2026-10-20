import { expect, test } from "bun:test";
import JSZip from "jszip";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { makeFormattedPdf, makeLinkedPdf, makePng, makeSamplePdf, makeShapesPdf } from "@/lib/pdf-to-word/fixture";
import type { ConvertDeps } from "@/lib/pdf-to-word";

import { convertPdfToPptx, type PptxConvertOptions } from "./convert";
import { slideSize } from "./pptx-writer";

const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
const deps: ConvertDeps = {
  OPS: OPS as unknown as Record<string, number>,
  rasterizeImage: async () => ({ data: makePng(6, 4, [10, 120, 200]), mime: "image/png" }),
  renderJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
};

async function convert(data: Uint8Array, options: Partial<PptxConvertOptions> = {}) {
  const pdf = await getDocument({ data, fontExtraProperties: true, standardFontDataUrl: FONTS }).promise;
  const progress: number[] = [];
  const result = await convertPdfToPptx(pdf as never, "Sample", { mode: "editable", size: "match", ...options }, deps, (r) => progress.push(r));
  await pdf.loadingTask.destroy();
  const zip = await JSZip.loadAsync(result.bytes);
  const slide = async (n: number) => zip.file(`ppt/slides/slide${n}.xml`)!.async("string");
  return { result, zip, slide, progress };
}

const textOf = (xml: string) => [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" ");

/** Every XML part must be well formed, or PowerPoint refuses the whole file. */
async function expectWellFormed(zip: JSZip) {
  const { DOMParser } = await import("@xmldom/xmldom");
  for (const name of Object.keys(zip.files)) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const xml = await zip.file(name)!.async("string");
    const errors: string[] = [];
    new DOMParser({ onError: (level, message) => { if (level !== "warning") errors.push(`${name}: ${message}`); } }).parseFromString(xml, "text/xml");
    expect(errors).toEqual([]);
  }
}

test("sample PDF becomes one editable slide per page with text, table and picture", async () => {
  const { result, zip, slide, progress } = await convert(await makeSamplePdf());
  expect(result.slides).toBeGreaterThanOrEqual(1);
  await expectWellFormed(zip);
  const all = (await Promise.all(Array.from({ length: result.slides }, (_, i) => slide(i + 1)))).join("");
  const text = textOf(all);
  for (const phrase of ["Quarterly Report", "The quick brown fox", "First bullet item", "Pears", "Closing line", "Appendix"]) {
    expect(text).toContain(phrase);
  }
  expect(all).toContain('<p:cNvSpPr txBox="1"/>');
  expect(all).toContain("<a:tbl>");
  expect(all).toContain("<p:pic>");
  expect(all).toMatch(/<a:buChar char="[^"]+"\/>|<a:buAutoNum/);
  // Part names must be plain (pdf.js refs carry a colon, which breaks strict readers).
  const parts = Object.keys(zip.files);
  expect(parts.some((f) => f.startsWith("ppt/media/"))).toBe(true);
  for (const part of parts) expect(part).toMatch(/^[A-Za-z0-9_./\[\]-]+$/);
  expect(progress.at(-1)).toBe(1);
  // Slide size matches the PDF page (US Letter portrait).
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  expect(pres).toContain(`<p:sldSz cx="${612 * 12700}" cy="${792 * 12700}"/>`);
});

test("colour, underline, strike, highlight, sub- and superscript carry over as run properties", async () => {
  const { slide } = await convert(await makeFormattedPdf());
  const xml = await slide(1);
  expect(xml).toContain('<a:srgbClr val="FF0000"/></a:solidFill><a:latin typeface="Times New Roman"/>');
  expect(xml).toMatch(/<a:rPr [^>]*u="sng"[^>]*><[^]*?<a:t>underlined<\/a:t>/);
  expect(xml).toMatch(/strike="sngStrike"[^]*?<a:t>struck<\/a:t>/);
  expect(xml).toMatch(/<a:highlight><a:srgbClr val="FFFF00"\/><\/a:highlight>[^]*?<a:t>highlighted<\/a:t>/);
  expect(xml).toMatch(/baseline="-25000"[^]*?<a:t>2<\/a:t>/);
  expect(xml).toMatch(/baseline="30000"/);
  expect(xml).toMatch(/sz="1200"/);
});

test("numbered items keep their own numbers across separate text boxes; one-line boxes do not wrap", async () => {
  const { result, slide } = await convert(await makeSamplePdf());
  const all = (await Promise.all(Array.from({ length: result.slides }, (_, i) => slide(i + 1)))).join("");
  const numbered = [...all.matchAll(/<a:buAutoNum type="[^"]+"( startAt="(\d+)")?\/>/g)].map((m) => Number(m[2] ?? 1));
  expect(numbered.length).toBeGreaterThanOrEqual(2);
  expect(numbered.slice(0, 2)).toEqual([1, 2]);
  expect(all).toContain('wrap="none"');
});

test("links become clickable hyperlinks", async () => {
  const { zip, slide } = await convert(await makeLinkedPdf());
  const xml = await slide(1);
  expect(xml).toContain("<a:hlinkClick r:id=");
  const rels = await zip.file("ppt/slides/_rels/slide1.xml.rels")!.async("string");
  expect(rels).toMatch(/Type="[^"]+\/hyperlink" Target="https?:\/\/[^"]+" TargetMode="External"/);
});

test("vector drawings stay native shapes", async () => {
  const { slide, zip } = await convert(await makeShapesPdf());
  await expectWellFormed(zip);
  const xml = await slide(1);
  expect(textOf(xml)).toContain("Diagram Page");
  const shapes = xml.match(/<p:sp><p:nvSpPr><p:cNvPr id="\d+" name="Shape/g) ?? [];
  expect(shapes.length).toBeGreaterThanOrEqual(3);
  expect(xml).toMatch(/prst="(rect|ellipse|line)"|<a:custGeom>/);
});

test("16:9 scales and centres each page; a page range picks slides", async () => {
  const { zip, result } = await convert(await makeSamplePdf(), { size: "16:9", pages: [1] });
  expect(result.slides).toBe(1);
  const pres = await zip.file("ppt/presentation.xml")!.async("string");
  expect(pres).toContain(`<p:sldSz cx="${960 * 12700}" cy="${540 * 12700}"/>`);
  // A portrait page on a wide slide sits in the middle: nothing starts left of the side margin.
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  const body = xml.slice(xml.indexOf("</p:grpSpPr>"));
  const xs = [...body.matchAll(/<a:off x="(\d+)"/g)].map((m) => Number(m[1]) / 12700);
  const margin = (960 - 612 * (540 / 792)) / 2;
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(margin - 2);
});

test("picture mode puts one full-slide image on each slide", async () => {
  const { zip, slide, result } = await convert(await makeSamplePdf(), { mode: "picture" });
  await expectWellFormed(zip);
  for (let n = 1; n <= result.slides; n++) {
    const xml = await slide(n);
    expect((xml.match(/<p:pic>/g) ?? []).length).toBe(1);
    expect(xml).toContain(`<a:off x="0" y="0"/><a:ext cx="${612 * 12700}" cy="${792 * 12700}"/>`);
  }
});

test("slide size stays inside PowerPoint's 1 to 56 inch limits", () => {
  expect(slideSize("match", { width: 10000, height: 5000 }).width).toBe(56 * 72);
  expect(slideSize("match", { width: 30, height: 30 }).width).toBe(72);
  expect(slideSize("4:3", { width: 612, height: 792 })).toEqual({ width: 720, height: 540 });
});

test("a one-line tabbed paragraph becomes one text box per tab stop (Google Slides ignores tab stops)", async () => {
  const { writePptx } = await import("./pptx-writer");
  const run = (text: string) => ({ text, size: 16 });
  const tab = { text: "", tab: true };
  const bytes = await writePptx(
    [{
      kind: "exact",
      page: {
        width: 960,
        height: 540,
        shapes: [],
        items: [{
          kind: "text",
          box: { x: 190, y: 450, w: 550, h: 19 },
          block: {
            type: "p",
            align: "right",
            runs: [run("North"), tab, run("East"), tab, run("South"), tab, run("West")],
            tabs: [{ pos: 170, kind: "left" }, { pos: 340, kind: "left" }, { pos: 510, kind: "left" }],
          },
        }],
      },
    }],
    {},
    { size: "match", title: "t" },
  );
  const xml = await (await JSZip.loadAsync(bytes)).file("ppt/slides/slide1.xml")!.async("string");
  const boxes = [...xml.matchAll(/<p:sp>.*?<a:off x="(\d+)"[^]*?<a:t>([^<]*)<\/a:t>[^]*?<\/p:sp>/g)].map((m) => [Math.round(Number(m[1]) / 12700), m[2]]);
  expect(boxes).toEqual([[189, "North"], [359, "East"], [529, "South"], [699, "West"]]);
  expect(xml).not.toContain("<a:t>\t</a:t>");
});
