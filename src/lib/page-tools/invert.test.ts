import { expect, test } from "bun:test";
import { PDFDocument, StandardFonts, rgb } from "@cantoo/pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { recolourPages, withoutText } from "./invert";

async function sample() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i++) {
    const p = doc.addPage([300, 200]);
    p.drawRectangle({ x: 20, y: 20, width: 80, height: 50, color: rgb(0.1, 0.3, 0.8) });
    p.drawText(`Hello page ${i + 1}`, { x: 20, y: 150, size: 18, font });
  }
  return doc.save();
}

async function pageText(bytes: Uint8Array, n: number) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const content = await (await pdf.getPage(n)).getTextContent();
  return content.items.map((i) => ("str" in i ? i.str : "")).join("");
}

async function modes(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const seen = new Set<string>();
  for (const m of new TextDecoder("latin1").decode(await doc.save({ useObjectStreams: false })).matchAll(/\/BM\s*\/(\w+)/g)) seen.add(m[1]);
  return seen;
}

test("invert is one Difference overlay and keeps the text bytes", async () => {
  const bytes = await sample();
  const doc = await PDFDocument.load(bytes);
  await recolourPages(doc, "invert");
  const out = await doc.save({ useObjectStreams: false });
  expect([...(await modes(out))]).toEqual(["Difference"]);
  expect(await pageText(out, 1)).toBe("Hello page 1");
  expect(out.length - bytes.length).toBeLessThan(2500);
});

test("sepia and grayscale use Color; sepia also multiplies", async () => {
  for (const [mode, want] of [["grayscale", ["Color"]], ["sepia", ["Color", "Multiply"]]] as const) {
    const doc = await PDFDocument.load(await sample());
    await recolourPages(doc, mode);
    expect([...(await modes(await doc.save()))].sort()).toEqual([...want].sort());
  }
});

test("dark adds the floor, the ceiling and a Hue pass with no text in it", async () => {
  const bytes = await sample();
  const doc = await PDFDocument.load(bytes);
  await recolourPages(doc, "dark", await withoutText(bytes));
  const seen = await modes(await doc.save());
  expect([...seen].sort()).toEqual(["Darken", "Difference", "Hue", "Lighten"]);
  // Original text once per page, not duplicated by the Hue pass.
  expect(await pageText(await doc.save(), 1)).toBe("Hello page 1");
});
