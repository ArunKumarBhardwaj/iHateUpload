import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  StandardFonts,
  cmyk,
  decodePDFRawStream,
} from "@cantoo/pdf-lib";

import { cffWidths } from "./cff";
import { convertToPdfA, planPdfA, type PdfALevel } from "./convert";
import { scanContent } from "./usage";

const N = PDFName.of;
const FONT_DIR = "node_modules/pdfjs-dist/standard_fonts/";
const loadFont = async (file: string) => new Uint8Array(readFileSync(FONT_DIR + file));

/** A 2x2 grey JPEG so picture pages need no canvas. */
const TINY_JPEG = Uint8Array.from(Buffer.from("/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAAqADAAQAAAABAAAAAgAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAAgACAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMAAgICAgICAwICAwUDAwMFBgUFBQUGCAYGBgYGCAoICAgICAgKCgoKCgoKCgwMDAwMDA4ODg4ODw8PDw8PDw8PD//bAEMBAgICBAQEBwQEBxALCQsQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEP/dAAQAAf/aAAwDAQACEQMRAD8AKKKKAP/Z", "base64"));

async function messy() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 400]);
  const fonts = await Promise.all(
    [StandardFonts.Helvetica, StandardFonts.TimesRomanBold, StandardFonts.Courier].map((f) =>
      doc.embedFont(f),
    ),
  );
  fonts.forEach((font, i) => page.drawText(`Line ${i} café`, { x: 20, y: 360 - i * 30, size: 14, font }));
  const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
  page.drawText("\u2714", { x: 20, y: 250, size: 14, font: dingbats });
  page.drawRectangle({ x: 200, y: 200, width: 50, height: 50, color: cmyk(0, 1, 1, 0) });
  const form = doc.getForm();
  const field = form.createTextField("name");
  field.setText("Ada");
  field.addToPage(page, { x: 20, y: 100, width: 120, height: 20 });
  form.createCheckBox("ok").addToPage(page, { x: 200, y: 100, width: 15, height: 15 });
  form.acroForm.dict.set(N("NeedAppearances"), doc.context.obj(true));
  const ctx = doc.context;
  const note = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [100, 10, 120, 30], Contents: "hi" }),
  );
  const highlight = ctx.register(
    ctx.obj({
      Type: "Annot",
      Subtype: "Highlight",
      Rect: [18, 355, 120, 375],
      QuadPoints: [18, 375, 120, 375, 18, 355, 120, 355],
      C: [1, 1, 0],
    }),
  );
  const link = ctx.register(
    ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [10, 10, 80, 30], A: { S: "URI", URI: "https://example.com" } }),
  );
  const annots = page.node.lookup(N("Annots"), PDFArray);
  for (const a of [note, highlight, link]) annots.push(a);
  const js = ctx.register(ctx.obj({ S: "JavaScript", JS: "app.alert(1)" }));
  doc.catalog.set(N("OpenAction"), js);
  await doc.attach(new TextEncoder().encode("a,b\n1,2\n"), "data.csv", { mimeType: "text/csv" });
  await doc.flush();
  const names = doc.catalog.lookup(N("Names"), PDFDict);
  names.set(N("JavaScript"), ctx.obj({ Names: ["x", js] }));
  doc.setTitle("Quarterly report");
  doc.setAuthor("Synthetic Author");
  return PDFDocument.load(await doc.save());
}

async function translucent() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Behind glass", { x: 20, y: 150, size: 18, font });
  page.drawRectangle({ x: 10, y: 140, width: 200, height: 40, opacity: 0.4 });
  return PDFDocument.load(await doc.save());
}

const picture = async () => ({
  jpeg: TINY_JPEG,
  width: 1,
  height: 1,
  text: [{ str: "Behind glass", x: 20, y: 150, size: 18, width: 110, angle: 0 }],
});

const convert = (doc: PDFDocument, level: PdfALevel) =>
  convertToPdfA(doc, level, { loadFont, picture, now: new Date("2026-10-24T10:00:00Z") });

function fontDicts(doc: PDFDocument): PDFDict[] {
  const out: PDFDict[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFStream ? null : null;
    if (dict && dict.get(N("Type"))?.toString() === "/Font") out.push(dict);
  }
  return out;
}

function embedded(doc: PDFDocument, font: PDFDict): boolean {
  const sub = font.get(N("Subtype"))?.toString();
  if (sub === "/Type3") return true;
  const target =
    sub === "/Type0"
      ? (doc.context.lookup(font.lookup(N("DescendantFonts"), PDFArray).get(0)) as PDFDict)
      : font;
  const desc = target.lookupMaybe(N("FontDescriptor"), PDFDict);
  return !!desc && ["FontFile", "FontFile2", "FontFile3"].some((k) => desc.has(N(k)));
}

const text = (s: PDFRawStream) => new TextDecoder("latin1").decode(s.getContents());

test("2b: output intent, XMP, ID, embedded fonts, no scripts or attachments", async () => {
  const doc = await messy();
  const report = await convert(doc, "2b");
  const saved = await PDFDocument.load(report.bytes);

  const intents = saved.catalog.lookup(N("OutputIntents"), PDFArray);
  const intent = saved.context.lookup(intents.get(0)) as PDFDict;
  expect(intent.get(N("S"))?.toString()).toBe("/GTS_PDFA1");
  const icc = decodePDFRawStream(intent.lookup(N("DestOutputProfile"), PDFRawStream)).decode();
  expect(new TextDecoder().decode(icc.subarray(36, 40))).toBe("acsp");

  const xmp = text(saved.catalog.lookup(N("Metadata"), PDFRawStream));
  expect(xmp).toContain("<pdfaid:part>2</pdfaid:part>");
  expect(xmp).toContain("<pdfaid:conformance>B</pdfaid:conformance>");
  expect(xmp).toContain("Quarterly report");

  expect(saved.context.trailerInfo.ID).toBeDefined();
  for (const font of fontDicts(saved)) expect(embedded(saved, font)).toBe(true);
  expect(report.fontsEmbedded.length).toBeGreaterThanOrEqual(4);

  expect(saved.catalog.get(N("OpenAction"))).toBeUndefined();
  const names = saved.catalog.lookupMaybe(N("Names"), PDFDict);
  expect(names?.get(N("JavaScript"))).toBeUndefined();
  expect(names?.get(N("EmbeddedFiles"))).toBeUndefined();
  expect(saved.catalog.lookup(N("AcroForm"), PDFDict).get(N("NeedAppearances"))).toBeUndefined();

  const annots = saved.getPage(0).node.lookup(N("Annots"), PDFArray).asArray();
  for (const ref of annots) {
    const a = saved.context.lookup(ref) as PDFDict;
    const sub = a.get(N("Subtype"))?.toString();
    expect((Number(a.get(N("F"))?.toString() ?? 0) & 4) !== 0).toBe(true);
    if (sub !== "/Link" && sub !== "/Popup") expect(a.lookupMaybe(N("AP"), PDFDict)?.has(N("N"))).toBe(true);
  }
  const resources = saved.getPage(0).node.lookup(N("Resources"), PDFDict);
  expect(resources.lookupMaybe(N("ColorSpace"), PDFDict)?.has(N("DefaultCMYK"))).toBe(true);
  expect(report.pagesAsPictures).toEqual([]);
});

test("3b keeps the attachment and marks its relationship", async () => {
  const report = await convert(await messy(), "3b");
  const saved = await PDFDocument.load(report.bytes);
  const af = saved.catalog.lookup(N("AF"), PDFArray);
  const spec = saved.context.lookup(af.get(0)) as PDFDict;
  expect(spec.get(N("AFRelationship"))?.toString()).toBe("/Unspecified");
  expect(spec.has(N("UF"))).toBe(true);
  const ef = spec.lookup(N("EF"), PDFDict).lookup(N("F"), PDFStream);
  expect(ef.dict.get(N("Subtype"))?.toString()).toBe("/text#2Fcsv");
});

test("1b plans transparent pages as pictures and keeps their text searchable", async () => {
  const doc = await translucent();
  expect(planPdfA(doc, "2b").pictures.size).toBe(0);
  expect([...planPdfA(doc, "1b").pictures.keys()]).toEqual([0]);
  const report = await convert(doc, "1b");
  expect(report.pagesAsPictures).toEqual([1]);
  const saved = await PDFDocument.load(report.bytes);
  const page = saved.getPage(0);
  const contents = page.node.get(N("Contents"));
  const stream = saved.context.lookup(contents instanceof PDFArray ? contents.get(0) : (contents as PDFRef));
  const ops = new TextDecoder("latin1").decode(decodePDFRawStream(stream as PDFRawStream).decode());
  expect(ops).toContain("3 Tr");
  expect(ops).toContain("Do");
});

// Real validation, when veraPDF is installed (brew install verapdf).
const verapdf = spawnSync("verapdf", ["--version"]).status === 0;

test.skipIf(!verapdf)("veraPDF passes every level", async () => {
  const dir = process.env.PDFA_OUT ?? mkdtempSync(join(tmpdir(), "pdfa-"));
  const results: string[] = [];
  for (const level of ["1b", "2b", "3b"] as const) {
    for (const [name, make] of [["messy", messy], ["translucent", translucent]] as const) {
      const out = join(dir, `${name}-${level}.pdf`);
      writeFileSync(out, (await convert(await make(), level)).bytes);
      const run = spawnSync("verapdf", ["-f", level, "--format", "text", out], { encoding: "utf8" });
      results.push(`${name} ${level}: ${run.stdout.trim().split(" ")[0]}`);
    }
  }
  expect(results.filter((r) => !r.endsWith("PASS"))).toEqual([]);
}, 120_000);

test("content scan finds the codes each font key draws", () => {
  const seen = new Map<string, Set<number>>();
  scanContent(new TextEncoder().encode("q BT /F1 12 Tf (Hi\\051) Tj [(A) -20 <42>] TJ ET Q BT /F2 9 Tf (z) ' ET"), seen);
  expect([...seen.get("F1")!].sort((a, b) => a - b)).toEqual([0x29, 0x41, 0x42, 0x48, 0x69]);
  expect([...seen.get("F2")!]).toEqual([0x7a]);
});

test("CFF widths come from the program, Euro included", async () => {
  const widths = cffWidths(await loadFont("FoxitSerif.pfb"))!;
  expect(widths.get("a")).toBe(444);
  expect(widths.get("Euro")).toBe(722);
});
