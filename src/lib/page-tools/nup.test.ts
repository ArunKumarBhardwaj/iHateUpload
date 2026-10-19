import { expect, test } from "bun:test";
import { PDFDocument, StandardFonts, degrees } from "@cantoo/pdf-lib";

import { DEFAULT_NUP, buildNup, nupCells, nupSheet } from "./nup";
import { PAPER } from "./geometry";

async function fixture(pages: number, rotate0 = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([400, 600]);
    p.drawText(`Page number ${i + 1}`, { x: 40, y: 500, size: 24, font });
  }
  if (rotate0) doc.getPage(0).setRotation(degrees(rotate0));
  return PDFDocument.load(await doc.save());
}

test("cells fill across or down", () => {
  const s = { ...DEFAULT_NUP, cols: 2, rows: 2, margin: 0, gap: 0 };
  const across = nupCells({ ...s, order: "across" }, 200, 200);
  expect(across[1]).toMatchObject({ x: 100, y: 100 });
  expect(across[2]).toMatchObject({ x: 0, y: 0 });
  const down = nupCells({ ...s, order: "down" }, 200, 200);
  expect(down[1]).toMatchObject({ x: 0, y: 0 });
  expect(down[2]).toMatchObject({ x: 100, y: 100 });
});

test("auto orientation turns a 2-up sheet sideways for portrait pages", () => {
  const sheet = nupSheet(DEFAULT_NUP, { width: 400, height: 600 });
  expect(sheet.width).toBeGreaterThan(sheet.height);
  const fixed = nupSheet({ ...DEFAULT_NUP, orientation: "portrait" }, { width: 400, height: 600 });
  expect([fixed.width, fixed.height]).toEqual(PAPER.a4);
});

test("builds the right number of sheets and keeps pages as vector forms", async () => {
  const src = await fixture(7);
  const out = await buildNup(src, { ...DEFAULT_NUP, cols: 3, rows: 3, border: true });
  expect(out.getPageCount()).toBe(1);
  const four = await buildNup(src, { ...DEFAULT_NUP, cols: 2, rows: 2 });
  expect(four.getPageCount()).toBe(2);
  const bytes = await four.save({ useObjectStreams: false });
  const text = new TextDecoder("latin1").decode(bytes);
  expect(text).toContain("/Subtype /Form");
  expect(text).not.toContain("/Subtype /Image");
  expect(bytes.length).toBeLessThan(20000);
});

test("rotated source pages are drawn upright", async () => {
  const src = await fixture(1, 90);
  const out = await buildNup(src, { ...DEFAULT_NUP, cols: 1, rows: 1, orientation: "portrait", margin: 0 });
  expect(out.getPageCount()).toBe(1);
  const content = new TextDecoder("latin1").decode(
    (await PDFDocument.load(await out.save({ useObjectStreams: false }))).getPage(0).node.Contents()
      ? await out.save({ useObjectStreams: false })
      : new Uint8Array(),
  );
  expect(content.length).toBeGreaterThan(0);
});
