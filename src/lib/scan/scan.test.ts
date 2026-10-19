import { expect, test } from "bun:test";
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from "@cantoo/pdf-lib";
import sharp from "sharp";

import { encodeJbig2 } from "@/lib/jbig2-encode";

import { buildScanPdf, placeOnPage } from "./build-pdf";
import { applyFilter } from "./filters";
import { cameraQuad, makeSheet, photographSheet } from "./fixtures";
import { detectDocument } from "./detect";
import { renderScanPage } from "./pipeline";
import type { Quad, RGBAImage } from "./types";

const mean = (img: RGBAImage, x0: number, y0: number, x1: number, y1: number) => {
  let s = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      s += img.data[(y * img.width + x) * 4];
      n++;
    }
  }
  return s / n;
};


test("the document filter evens out a shaded, tinted sheet", () => {
  const sheet = makeSheet(400, 500);
  const photo = photographSheet(sheet, [
    { x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 500 }, { x: 0, y: 500 },
  ], { width: 400, height: 500, shade: 0.45 });
  const before = mean(photo, 340, 230, 390, 250);
  const after = mean(applyFilter(photo, "document").rgba, 340, 230, 390, 250);
  expect(before).toBeLessThan(170);
  expect(after).toBeGreaterThan(235);
});

test("B&W gives only black and white plus ink samples", () => {
  const sheet = makeSheet(400, 500);
  const { rgba, ink } = applyFilter(sheet, "bw");
  expect(ink).toBeDefined();
  const values = new Set<number>();
  for (let i = 0; i < rgba.data.length; i += 4) values.add(rgba.data[i]);
  expect([...values].sort()).toEqual([0, 255]);
  expect(ink!.reduce((a, b) => a + b, 0)).toBeGreaterThan(1000);
});

test("brightness and contrast move tones the right way", () => {
  const sheet = makeSheet(100, 100);
  const base = mean(applyFilter(sheet, "gray").rgba, 0, 90, 100, 100);
  const dim = mean(applyFilter(sheet, "gray", -40, 0).rgba, 0, 90, 100, 100);
  expect(dim).toBeLessThan(base);
  const flatter = applyFilter(sheet, "original", 0, -60).rgba;
  expect(mean(flatter, 10, 8, 40, 9)).toBeGreaterThan(60);
});

test("render flattens perspective and keeps text on the sheet", () => {
  const cam = cameraQuad(210, 280, { yaw: 0.45, pitch: 0.35, dist: 420, focal: 900, width: 1000, height: 1200 });
  const photo = photographSheet(makeSheet(600, 800), cam, { width: 1000, height: 1200 });
  const norm = cam.map((p) => ({ x: p.x / 1000, y: p.y / 1200 })) as Quad;
  const out = renderScanPage(photo, {
    corners: norm, rotate: 0, filter: "document", brightness: 0, contrast: 0, maxSide: 1000,
  });
  expect(Math.abs(out.rgba.width / out.rgba.height - 0.75)).toBeLessThan(0.05);
  expect(mean(out.rgba, 100, Math.round(out.rgba.height * 0.07), 300, Math.round(out.rgba.height * 0.09))).toBeLessThan(120);
  const turned = renderScanPage(photo, {
    corners: norm, rotate: 90, filter: "original", brightness: 0, contrast: 0, maxSide: 1000,
  });
  expect(turned.rgba.width).toBeGreaterThan(turned.rgba.height);
});

test("page sizes: A4 fills a matching sheet, letterboxes others, original keeps pixels", () => {
  const a4 = placeOnPage(2480, 3508, "a4");
  expect(a4.page[0]).toBeCloseTo(595.28, 1);
  expect(a4.x).toBe(0);
  const wide = placeOnPage(2000, 1000, "letter");
  expect(wide.page).toEqual([792, 612]);
  const odd = placeOnPage(1000, 1000, "a4");
  expect(odd.x).toBeGreaterThan(0 - 1e-9);
  expect(odd.y).toBeGreaterThan(100);
  const orig = placeOnPage(1500, 1500, "original");
  expect(orig.page[0]).toBeCloseTo(720, 5);
});

test("a PDF of JBIG2 and JPEG pages carries the bytes and the page sizes", async () => {
  const ink = new Uint8Array(200 * 300);
  for (let y = 40; y < 60; y++) for (let x = 20; x < 180; x++) ink[y * 200 + x] = 1;
  const jb = encodeJbig2(ink, 200, 300);
  const jpeg = new Uint8Array(
    await sharp({ create: { width: 120, height: 160, channels: 3, background: "#808080" } })
      .jpeg()
      .toBuffer(),
  );
  const bytes = await buildScanPdf(
    [
      { width: 200, height: 300, kind: "jbig2", bytes: jb },
      { width: 120, height: 160, kind: "jpeg", bytes: jpeg },
    ],
    "a4",
  );
  const doc = await PDFDocument.load(bytes);
  expect(doc.getPageCount()).toBe(2);
  expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
  let found = false;
  doc.context.enumerateIndirectObjects().forEach(([, obj]) => {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Filter")) === PDFName.of("JBIG2Decode")) {
      expect(Buffer.from(obj.contents).equals(Buffer.from(jb))).toBe(true);
      found = true;
    }
  });
  expect(found).toBe(true);
});

test("an OCR text PDF lends its invisible words to a page with our image", async () => {
  // Stand-in for Tesseract's output: an image page with invisible text.
  const tess = await PDFDocument.create();
  const tp = tess.addPage([300, 400]);
  const font = await tess.embedFont(StandardFonts.Helvetica);
  const png = await sharp({ create: { width: 30, height: 40, channels: 3, background: "#fff" } }).png().toBuffer();
  tp.drawImage(await tess.embedPng(png), { x: 0, y: 0, width: 300, height: 400 });
  tp.drawText("Hello scan", { x: 20, y: 200, size: 18, font, opacity: 0 });
  const textPdf = new Uint8Array(await tess.save());
  const ink = new Uint8Array(300 * 400);
  const jb = encodeJbig2(ink, 300, 400);
  const bytes = await buildScanPdf(
    [{ width: 300, height: 400, kind: "jbig2", bytes: jb, textPdf }],
    "original",
  );
  const doc = await PDFDocument.load(bytes);
  let jbig = 0;
  let pngLike = 0;
  doc.context.enumerateIndirectObjects().forEach(([, obj]) => {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) {
      if (obj.dict.get(PDFName.of("Filter")) === PDFName.of("JBIG2Decode")) jbig++;
      else pngLike++;
    }
  });
  expect(jbig).toBe(1);
  expect(pngLike).toBe(0);
  expect(Buffer.from(bytes).includes(Buffer.from("Hello scan"))).toBe(false); // compressed streams
  expect(bytes.length).toBeGreaterThan(500);
});

for (const background of ["desk", "dark"] as const) {
  test(`the scanned page is pure page, no ${background} background at its edges`, () => {
    const sheet = makeSheet(600, 800);
    const cam = cameraQuad(210, 297, { yaw: 0.4, pitch: 0.3, roll: 0.08, dist: 270, focal: 500, width: 800, height: 1000 });
    const photo = photographSheet(sheet, cam, { width: 800, height: 1000, background, noise: 8, shade: 0.2 });
    const found = detectDocument(photo);
    expect(found.found).toBe(true);
    const corners = found.quad.map((p) => ({ x: p.x / photo.width, y: p.y / photo.height })) as Quad;
    const base = { corners, rotate: 0 as const, brightness: 0, contrast: 0, maxSide: 1200 };

    const doc = renderScanPage(photo, { ...base, filter: "document" }).rgba;
    const bx = Math.round(doc.width * 0.02);
    const by = Math.round(doc.height * 0.02);
    const interior = mean(doc, bx * 2, by * 2, doc.width - bx * 2, doc.height - by * 2);
    for (const [x0, y0, x1, y1] of [
      [0, 0, bx, doc.height],
      [doc.width - bx, 0, doc.width, doc.height],
      [0, 0, doc.width, by],
      [0, doc.height - by, doc.width, doc.height],
    ]) {
      expect(mean(doc, x0, y0, x1, y1)).toBeGreaterThanOrEqual(interior);
    }

    const bw = renderScanPage(photo, { ...base, filter: "bw" });
    const ink = bw.ink!;
    const { width: w, height: h } = bw.rgba;
    const col = (x: number) => {
      let n = 0;
      for (let y = 0; y < h; y++) n += ink[y * w + x];
      return n / h;
    };
    const row = (y: number) => {
      let n = 0;
      for (let x = 0; x < w; x++) n += ink[y * w + x];
      return n / w;
    };
    for (let i = 0; i < Math.round(w * 0.02); i++) {
      expect(col(i)).toBeLessThan(0.3);
      expect(col(w - 1 - i)).toBeLessThan(0.3);
    }
    for (let i = 0; i < Math.round(h * 0.02); i++) {
      expect(row(i)).toBeLessThan(0.3);
      expect(row(h - 1 - i)).toBeLessThan(0.3);
    }
  });
}
