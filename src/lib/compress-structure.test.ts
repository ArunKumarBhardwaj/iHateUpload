import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from "@cantoo/pdf-lib";
import { unzlibSync } from "fflate";

import { createWasmCodec } from "./compress-codec";
import { compressPdfBytes } from "./compress-engine";
import { COMPRESS_PLANS } from "./compress-plans";
import { dedupe, dropUnreachable, recompressStreams, stripInvisible } from "./compress-structure";

const codec = createWasmCodec(async (file) => WebAssembly.compile(readFileSync(`public/codecs/${file}`)));
const FONT = readFileSync("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf");

const streams = (doc: PDFDocument) => [...doc.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFRawStream).length;

async function pageWithBigStream(doc: PDFDocument, n: number) {
  const page = doc.addPage([300, 300]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(`Page ${n}`, { x: 20, y: 250, size: 20, font });
  return page;
}

test("objects only a deleted page used are dropped", async () => {
  const doc = await PDFDocument.create();
  for (let n = 0; n < 3; n++) {
    const page = await pageWithBigStream(doc, n);
    const blob = doc.context.register(doc.context.flateStream(new Uint8Array(50_000).map((_, i) => (i * 7 + n) & 255)));
    page.node.set(PDFName.of("Junk"), blob);
  }
  doc.removePage(2);
  doc.removePage(1);
  const before = streams(doc);
  const dropped = dropUnreachable(doc);
  expect(dropped).toBeGreaterThan(0);
  expect(streams(doc)).toBeLessThan(before);
  // What the kept page uses survives.
  expect(doc.getPage(0).node.lookup(PDFName.of("Junk"))).toBeInstanceOf(PDFRawStream);
});

test("the same font embedded by twelve merged files is stored once", async () => {
  const merged = await PDFDocument.create();
  for (let i = 0; i < 12; i++) {
    const one = await PDFDocument.create();
    one.registerFontkit(fontkit);
    const font = await one.embedFont(FONT, { subset: false });
    one.addPage([300, 300]).drawText(`Letter ${i}`, { x: 20, y: 250, size: 20, font });
    const loaded = await PDFDocument.load(await one.save());
    const [copied] = await merged.copyPages(loaded, [0]);
    merged.addPage(copied);
  }
  const fontFiles = () =>
    [...merged.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFRawStream && o.contents.length > 50_000).length;
  expect(fontFiles()).toBe(12);
  expect(dedupe(merged)).toBeGreaterThan(12);
  expect(fontFiles()).toBe(1);
  // Every page still finds its font.
  const reloaded = await PDFDocument.load(await merged.save());
  expect(reloaded.getPageCount()).toBe(12);
});

test("thumbnails, app-private data and XMP go; PDF/A keeps its XMP", async () => {
  const doc = await PDFDocument.create();
  const page = await pageWithBigStream(doc, 0);
  page.node.set(PDFName.of("Thumb"), doc.context.register(doc.context.flateStream(new Uint8Array(1000))));
  page.node.set(PDFName.of("PieceInfo"), doc.context.obj({ Illustrator: { Private: "x" } }));
  const xmp = (s: string) => doc.context.register(doc.context.stream(new TextEncoder().encode(s), { Type: "Metadata", Subtype: "XML" }));
  doc.catalog.set(PDFName.of("Metadata"), xmp("<x:xmpmeta>plain</x:xmpmeta>"));
  expect(stripInvisible(doc)).toBe(3);
  expect(page.node.has(PDFName.of("Thumb"))).toBe(false);
  expect(doc.catalog.has(PDFName.of("Metadata"))).toBe(false);

  doc.catalog.set(PDFName.of("Metadata"), xmp("<x:xmpmeta><pdfaid:part>2</pdfaid:part></x:xmpmeta>"));
  stripInvisible(doc);
  expect(doc.catalog.has(PDFName.of("Metadata"))).toBe(true);
});

test("streams are deflated again only when smaller, and still decode", async () => {
  const doc = await PDFDocument.create();
  const text = new TextEncoder().encode("BT /F1 12 Tf 72 712 Td (Hello) Tj ET\n".repeat(400));
  const raw = doc.context.register(doc.context.stream(text, {}));
  const before = (doc.context.lookup(raw) as PDFRawStream).contents.length;
  expect(recompressStreams(doc)).toBe(1);
  const s = doc.context.lookup(raw) as PDFRawStream;
  expect(s.contents.length).toBeLessThan(before / 10);
  expect(unzlibSync(s.contents)).toEqual(text);
});

test("a merged file with whole fonts shrinks to a fraction, text intact", async () => {
  const merged = await PDFDocument.create();
  for (let i = 0; i < 4; i++) {
    const one = await PDFDocument.create();
    one.registerFontkit(fontkit);
    const font = await one.embedFont(FONT, { subset: false });
    one.addPage([300, 300]).drawText(`Letter ${i} from the bank`, { x: 20, y: 250, size: 14, font });
    const [copied] = await merged.copyPages(await PDFDocument.load(await one.save()), [0]);
    merged.addPage(copied);
  }
  const input = await merged.save();
  const { bytes, stats } = await compressPdfBytes(input, COMPRESS_PLANS.light, codec);
  expect(stats.folded).toBeGreaterThan(0);
  expect(stats.fontBytes).toBeGreaterThan(50_000);
  expect(bytes.length).toBeLessThan(input.length / 10);
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const pdf = await getDocument({ data: bytes.slice() }).promise;
  for (let n = 1; n <= 4; n++) {
    const text = await (await pdf.getPage(n)).getTextContent();
    expect(text.items.map((i) => ("str" in i ? i.str : "")).join("")).toBe(`Letter ${n - 1} from the bank`);
  }
});
