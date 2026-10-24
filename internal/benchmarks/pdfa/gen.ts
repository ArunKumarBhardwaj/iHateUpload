// Synthetic corpus for PDF to PDF/A. Every file is generated here; no personal documents.
// Usage: bun internal/benchmarks/pdfa/gen.ts   -> internal/benchmarks/pdfa/fx/*.pdf
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRef,
  PDFString,
  StandardFonts,
  TextRenderingMode,
  beginText,
  cmyk,
  endText,
  moveText,
  rgb,
  setFontAndSize,
  setTextRenderingMode,
  showText,
} from "@cantoo/pdf-lib";

const N = PDFName.of;
const fx = new URL("./fx/", import.meta.url).pathname;
mkdirSync(fx, { recursive: true });

const save = async (name: string, doc: PDFDocument, objectStreams = true) =>
  writeFileSync(fx + name + ".pdf", await doc.save({ useObjectStreams: objectStreams }));

const LOREM =
  "Quarterly archive copy. The committee reviewed spending, staffing and the facilities plan. " +
  "Totals below are synthetic and exist only to exercise the converter.";

/** 2x2 PNG with an alpha channel, built by hand. */
function alphaPng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let r = -1;
    for (const x of b) r = crcTable[(r ^ x) & 255] ^ (r >>> 8);
    return (r ^ -1) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.from([0, 255, 0, 0, 255, 0, 0, 255, 90, 0, 0, 255, 90, 0, 0, 255, 255, 0, 255, 0, 160]);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

async function base(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor("Synthetic Author");
  doc.setSubject("PDF/A benchmark");
  doc.setKeywords(["archive", "synthetic"]);
  return doc;
}

// 1. Standard fonts, a form, comments without appearances, a script and an attachment.
{
  const doc = await base("Forms and comments");
  const page = doc.addPage([595, 842]);
  const fonts = await Promise.all(
    [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.TimesRoman, StandardFonts.TimesRomanItalic, StandardFonts.Courier].map((f) => doc.embedFont(f)),
  );
  fonts.forEach((font, i) => page.drawText(`Font sample ${i + 1}: Größe café — “quotes” €42`, { x: 50, y: 780 - i * 26, size: 13, font }));
  const symbol = await doc.embedFont(StandardFonts.Symbol);
  page.drawText("αβγ ∑ π", { x: 50, y: 630, size: 14, font: symbol });
  const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
  page.drawText("✔ ✈ ☎", { x: 200, y: 630, size: 14, font: dingbats });
  const form = doc.getForm();
  const name = form.createTextField("applicant");
  name.setText("Jordan Example");
  name.addToPage(page, { x: 50, y: 560, width: 200, height: 22 });
  const agree = form.createCheckBox("agree");
  agree.check();
  agree.addToPage(page, { x: 270, y: 562, width: 16, height: 16 });
  const choice = form.createDropdown("region");
  choice.addOptions(["North", "South"]);
  choice.select("South");
  choice.addToPage(page, { x: 300, y: 560, width: 120, height: 22 });
  form.acroForm.dict.set(N("NeedAppearances"), doc.context.obj(true));
  const ctx = doc.context;
  const annots = page.node.lookup(N("Annots"), PDFArray);
  const add = (o: Record<string, unknown>) => annots.push(ctx.register(ctx.obj({ Type: "Annot", ...o } as never)));
  add({ Subtype: "Highlight", Rect: [48, 774, 400, 796], QuadPoints: [48, 796, 400, 796, 48, 774, 400, 774], C: [1, 0.9, 0] });
  add({ Subtype: "Underline", Rect: [48, 748, 400, 770], QuadPoints: [48, 770, 400, 770, 48, 748, 400, 748], C: [0, 0, 1] });
  add({ Subtype: "Square", Rect: [450, 700, 540, 790], C: [1, 0, 0], BS: { W: 2 } });
  add({ Subtype: "Text", Rect: [500, 600, 520, 620], Contents: PDFString.of("Check this") });
  add({ Subtype: "FreeText", Rect: [50, 450, 300, 500], Contents: PDFString.of("Reviewed by the archive team"), DA: PDFString.of("/Helv 11 Tf 0 g") });
  add({ Subtype: "Ink", Rect: [320, 440, 420, 500], InkList: [[320, 450, 350, 490, 380, 450, 410, 490]], C: [0, 0.5, 0] });
  add({ Subtype: "Link", Rect: [50, 400, 200, 420], A: { S: "URI", URI: "https://example.com/archive" } });
  add({ Subtype: "Link", Rect: [50, 380, 200, 400], A: { S: "JavaScript", JS: "app.alert('hi')" } });
  page.drawText("Example link", { x: 50, y: 405, size: 12, font: fonts[0], color: rgb(0, 0, 0.8) });
  const js = ctx.register(ctx.obj({ S: "JavaScript", JS: "app.alert('opened')" }));
  doc.catalog.set(N("OpenAction"), js);
  page.node.set(N("AA"), ctx.obj({ O: js }));
  await doc.attach(new TextEncoder().encode("id,total\n1,100\n2,250\n"), "totals.csv", { mimeType: "text/csv", description: "Totals" });
  await doc.flush();
  doc.catalog.lookup(N("Names"), PDFDict).set(N("JavaScript"), ctx.obj({ Names: ["init", js] }));
  await save("forms-comments", doc);
}

// 2. A scan: one JPEG per page plus an invisible OCR text layer.
{
  const doc = await base("Scanned letter");
  const image = await doc.embedJpg(new Uint8Array(readFileSync(new URL("./tiny-grey.jpg", import.meta.url).pathname)));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < 2; p++) {
    const page = doc.addPage([595, 842]);
    page.drawImage(image, { x: 0, y: 0, width: 595, height: 842 });
    const key = page.node.newFontDictionary("F", (font as unknown as { ref: PDFRef }).ref);
    page.pushOperators(
      beginText(),
      setFontAndSize(key, 14),
      setTextRenderingMode(TextRenderingMode.Invisible),
      moveText(60, 760),
      showText(font.encodeText(`Scanned page ${p + 1} invisible OCR words`)),
      endText(),
    );
  }
  await save("scan-ocr", doc);
}

// 3. Print-shop colours: DeviceCMYK fills and strokes.
{
  const doc = await base("CMYK flyer");
  const page = doc.addPage([420, 595]);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  page.drawRectangle({ x: 20, y: 400, width: 380, height: 170, color: cmyk(1, 0, 0, 0) });
  page.drawRectangle({ x: 20, y: 220, width: 180, height: 160, color: cmyk(0, 1, 0, 0) });
  page.drawRectangle({ x: 220, y: 220, width: 180, height: 160, color: cmyk(0, 0, 1, 0) });
  page.drawText("Spring sale", { x: 40, y: 470, size: 36, font, color: cmyk(0, 0, 0, 1) });
  page.drawText(LOREM.slice(0, 60), { x: 20, y: 180, size: 10, font, color: cmyk(0.2, 0.2, 0.2, 0.8) });
  await save("cmyk-flyer", doc);
}

// 4. Layers: one shown, one hidden by default.
{
  const doc = await base("Layered plan");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const ctx = doc.context;
  const shown = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Notes") }));
  const hidden = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Draft marks") }));
  doc.catalog.set(N("OCProperties"), ctx.obj({ OCGs: [shown, hidden], D: { Order: [shown], OFF: [hidden], AS: [{ Event: "View", Category: ["View"], OCGs: [shown] }] } }));
  const fontKey = page.node.newFontDictionary("F", (font as unknown as { ref: PDFRef }).ref);
  const props = ctx.obj({ L1: shown, L2: hidden });
  page.node.Resources()!.set(N("Properties"), props);
  page.drawText("Always visible title", { x: 50, y: 780, size: 20, font });
  const content = `/OC /L1 BDC BT ${fontKey} 14 Tf 50 740 Td (Visible layer text) Tj ET EMC /OC /L2 BDC 1 0 0 rg 40 600 300 80 re f EMC`;
  const stream = ctx.register(ctx.stream(content));
  page.node.addContentStream(stream);
  await save("layers", doc);
}

// 5. A Word-style PDF that names Arial (TrueType) without embedding it.
{
  const doc = await base("Unembedded Arial");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Body set in Arial, which the file does not carry.", { x: 50, y: 780, size: 14, font });
  page.drawText(LOREM, { x: 50, y: 750, size: 9, font, maxWidth: 500, lineHeight: 12 });
  await doc.flush();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(N("BaseFont"))?.toString() === "/Helvetica") {
      obj.set(N("Subtype"), N("TrueType"));
      obj.set(N("BaseFont"), N("Arial"));
      const widths = Array.from({ length: 224 }, (_, i) => Math.round(font.widthOfTextAtSize(String.fromCharCode(32 + i), 1000)) || 556);
      obj.set(N("FirstChar"), doc.context.obj(32));
      obj.set(N("LastChar"), doc.context.obj(255));
      obj.set(N("Widths"), doc.context.obj(widths));
      obj.set(N("FontDescriptor"), doc.context.register(doc.context.obj({ Type: "FontDescriptor", FontName: "Arial", Flags: 32, FontBBox: [-665, -325, 2000, 1040], ItalicAngle: 0, Ascent: 905, Descent: -212, CapHeight: 716, StemV: 80 })));
    }
  }
  await save("arial-unembedded", doc);
}

// 6. CJK text in a Type 0 font that is not embedded: only a picture page can fix it.
{
  const doc = await base("Unembedded CJK");
  const page = doc.addPage([595, 842]);
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Page with a missing Japanese font", { x: 50, y: 780, size: 16, font: latin });
  const ctx = doc.context;
  const cid = ctx.register(ctx.obj({ Type: "Font", Subtype: "CIDFontType2", BaseFont: "MS-Mincho", CIDSystemInfo: { Registry: "Adobe", Ordering: "Japan1", Supplement: 4 }, FontDescriptor: ctx.register(ctx.obj({ Type: "FontDescriptor", FontName: "MS-Mincho", Flags: 4, FontBBox: [0, -141, 1000, 859], ItalicAngle: 0, Ascent: 859, Descent: -141, CapHeight: 700, StemV: 80 })), DW: 1000 }));
  const type0 = ctx.register(ctx.obj({ Type: "Font", Subtype: "Type0", BaseFont: "MS-Mincho", Encoding: "UniJIS-UCS2-H", DescendantFonts: [cid] }));
  const key = page.node.newFontDictionary("J", type0);
  page.node.addContentStream(ctx.register(ctx.stream(`BT ${key} 20 Tf 50 700 Td <65E5672C8A9E> Tj ET`)));
  await save("cjk-unembedded", doc);
}

// 7. LZW-compressed page content, written without object streams like old producers.
{
  const doc = await base("LZW content");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const key = page.node.newFontDictionary("F", (font as unknown as { ref: PDFRef }).ref);
  await doc.flush();
  const text = `BT ${key} 18 Tf 50 780 Td (Old LZW encoded page) Tj ET 0 0 1 RG 4 w 50 760 m 400 760 l S`;
  const stream = doc.context.stream(lzw(new TextEncoder().encode(text)), { Filter: "LZWDecode" });
  page.node.addContentStream(doc.context.register(stream));
  await save("lzw", doc, false);
}

// 8. See-through drawing and a picture with an alpha channel (fine in 2b, not in 1b).
{
  const doc = await base("Transparency");
  const page = doc.addPage([595, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText("Text under a tinted panel", { x: 60, y: 700, size: 22, font });
  page.drawRectangle({ x: 40, y: 680, width: 400, height: 60, color: rgb(0.2, 0.4, 1), opacity: 0.3 });
  const png = await doc.embedPng(alphaPng());
  page.drawImage(png, { x: 60, y: 400, width: 200, height: 200 });
  page.drawText("Logo above has soft edges", { x: 60, y: 380, size: 12, font });
  await save("transparency", doc);
}

/** A plain LZW encoder (EarlyChange 1), for the old-producer fixture. */
function lzw(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let bitBuf = 0;
  let bitLen = 0;
  let width = 9;
  const write = (code: number) => {
    bitBuf = (bitBuf << width) | code;
    bitLen += width;
    while (bitLen >= 8) {
      out.push((bitBuf >> (bitLen - 8)) & 0xff);
      bitLen -= 8;
    }
  };
  let dict = new Map<string, number>();
  let next = 258;
  const reset = () => {
    dict = new Map();
    for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
    next = 258;
    width = 9;
  };
  reset();
  write(256);
  let w = "";
  for (const byte of data) {
    const c = String.fromCharCode(byte);
    if (dict.has(w + c)) {
      w += c;
      continue;
    }
    write(dict.get(w)!);
    dict.set(w + c, next++);
    if (next + 1 > 1 << width) width++;
    if (width > 12) {
      write(256);
      reset();
    }
    w = c;
  }
  if (w) write(dict.get(w)!);
  write(257);
  if (bitLen > 0) out.push((bitBuf << (8 - bitLen)) & 0xff);
  return Uint8Array.from(out);
}

console.log("fixtures written to", fx);
