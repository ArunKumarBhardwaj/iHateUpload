import { expect, test } from "bun:test";
import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  StandardFonts,
  degrees,
} from "@cantoo/pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { readFileSync } from "node:fs";

import { processEditPdf } from "./extra-processors";
import { mergeTextRuns, pdfJsItemsToRuns, textMarkBox } from "./pdf-edit-runs";
import { newTextMark, type EditMark } from "./tool-options";

const liberation = () => readFileSync("public/fonts/LiberationSans-Regular.ttf");

async function open(bytes: Uint8Array) {
  return getDocument({ data: bytes.slice() }).promise;
}

/** Page text lines the way the editor sees them (merged runs, page ratios). */
async function runsOf(bytes: Uint8Array) {
  const pdf = await open(bytes);
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  return mergeTextRuns(
    pdfJsItemsToRuns(content.items as never, viewport.width, viewport.height, (x, y) => {
      const p = viewport.convertToViewportPoint(x, y);
      return { x: p[0], y: p[1] };
    }),
  );
}

async function fullText(bytes: Uint8Array) {
  const pdf = await open(bytes);
  const page = await pdf.getPage(1);
  const content = await page.getTextContent();
  return content.items.map((i) => ("str" in i ? i.str : "")).join("|");
}

/** Replace the line containing `needle` as the editor does when a line is edited. */
async function replaceLine(bytes: Uint8Array, needle: string, text: string) {
  const runs = await runsOf(bytes);
  const run = runs.find((r) => r.text.includes(needle));
  if (!run) throw new Error(`no line holds ${needle}: ${runs.map((r) => r.text).join(" / ")}`);
  const box = textMarkBox(run);
  const mark = newTextMark(0, box.x, box.y, { w: box.w, h: box.h, text, fontSize: box.fontSize, cover: true });
  const file = new File([bytes.slice()], "in.pdf", { type: "application/pdf" });
  const [result] = await processEditPdf(
    [{ id: "1", name: "in.pdf", size: file.size, file }],
    () => {},
    { kind: "edit", marks: [mark as EditMark] },
  );
  return new Uint8Array(await result.blob.arrayBuffer());
}

async function twoColumn(kind: "std" | "type0" | "tj" | "truetype" | "rotated") {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const page = doc.addPage([600, 400]);
  if (kind === "std") {
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    page.drawText("Invoice for Acme Corp", { x: 40, y: 300, size: 18, font });
    page.drawText("Total 1200 USD", { x: 380, y: 300, size: 18, font });
    page.drawText("Second line stays", { x: 40, y: 200, size: 18, font });
  } else if (kind === "rotated") {
    // /Rotate 90 with the text turned back so it reads upright on screen.
    const font = await doc.embedFont(StandardFonts.TimesRoman);
    const turn = degrees(90);
    page.drawText("Invoice for Acme Corp", { x: 60, y: 40, size: 18, font, rotate: turn });
    page.drawText("Total 1200 USD", { x: 60, y: 240, size: 18, font, rotate: turn });
    page.drawText("Second line stays", { x: 160, y: 40, size: 18, font, rotate: turn });
    page.setRotation(degrees(90));
  } else if (kind === "type0") {
    const font = await doc.embedFont(liberation(), { subset: false });
    page.drawText("Invoice for Acme Corp", { x: 40, y: 300, size: 18, font });
    page.drawText("Total 1200 USD", { x: 380, y: 300, size: 18, font });
    page.drawText("Second line stays", { x: 40, y: 200, size: 18, font });
  } else if (kind === "tj") {
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const key = page.node.newFontDictionary("F1", font.ref).decodeText();
    const stream = doc.context.stream(
      [
        `BT /${key} 18 Tf 40 300 Td [(Inv) 40 (oice) -250 ( for A) 30 (cme) 15 ( Corp)] TJ ET`,
        `BT /${key} 18 Tf 380 300 Td (Total 1200 USD) Tj ET`,
        `BT /${key} 18 Tf 40 200 Td (Second line stays) Tj ET`,
      ].join("\n"),
    );
    page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  } else {
    // A simple (one byte) TrueType font dictionary with the whole file embedded.
    const data = liberation();
    const ttf = fontkit.create(data) as unknown as {
      unitsPerEm: number;
      glyphForCodePoint(c: number): { advanceWidth: number };
      postscriptName: string;
    };
    const file = doc.context.register(
      doc.context.flateStream(data, { Length1: data.length }),
    );
    const widths: number[] = [];
    for (let c = 32; c < 256; c++) {
      widths.push(Math.round((ttf.glyphForCodePoint(c).advanceWidth * 1000) / ttf.unitsPerEm));
    }
    const descriptor = doc.context.register(
      doc.context.obj({
        Type: "FontDescriptor",
        FontName: ttf.postscriptName,
        Flags: 32,
        FontBBox: [-200, -300, 1200, 1000],
        ItalicAngle: 0,
        Ascent: 900,
        Descent: -200,
        CapHeight: 700,
        StemV: 80,
        FontFile2: file,
      }),
    );
    const fontRef = doc.context.register(
      doc.context.obj({
        Type: "Font",
        Subtype: "TrueType",
        BaseFont: ttf.postscriptName,
        FirstChar: 32,
        LastChar: 255,
        Widths: widths,
        Encoding: "WinAnsiEncoding",
        FontDescriptor: descriptor,
      }),
    );
    const key = page.node.newFontDictionary("F1", fontRef).decodeText();
    const stream = doc.context.stream(
      [
        `BT /${key} 18 Tf 40 300 Td (Invoice for Acme Corp) Tj ET`,
        `BT /${key} 18 Tf 380 300 Td (Total 1200 USD) Tj ET`,
        `BT /${key} 18 Tf 40 200 Td (Second line stays) Tj ET`,
      ].join("\n"),
    );
    page.node.set(PDFName.of("Contents"), doc.context.register(stream));
  }
  void PDFArray;
  void PDFNumber;
  return doc.save();
}

for (const kind of ["std", "type0", "tj", "truetype", "rotated"] as const) {
  test(`replacing a line removes the old text and keeps neighbours (${kind})`, async () => {
    const input = await twoColumn(kind);
    expect(await fullText(input)).toContain("Acme Corp");
    const out = await replaceLine(input, "Acme", "Invoice for Globex");
    const text = await fullText(out);
    expect(text).not.toContain("Acme");
    expect(text).toContain("Globex");
    expect(text).toContain("Total 1200 USD");
    expect(text).toContain("Second line stays");
  });
}
