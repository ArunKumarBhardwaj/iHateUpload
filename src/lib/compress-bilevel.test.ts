import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream } from "@cantoo/pdf-lib";

import { binarize, lumaOf, packGray1, unpackGray1 } from "./bilevel";
import { createWasmCodec } from "./compress-codec";
import { compressPdfBytes, compressPdfToTarget } from "./compress-engine";
import { COMPRESS_PLANS } from "./compress-plans";
import { decodeJbig2Generic } from "./jbig2-decode.testutil";

const codec = createWasmCodec(async (file) =>
  WebAssembly.compile(readFileSync(`public/codecs/${file}`)),
);

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Deterministic noise per cell: strokes that don't repeat, so deflate can't cheat. */
function hash(a: number, b: number) {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
}

const W = 1275; // letter at 150 dpi keeps the tests quick
const H = 1650;

/** Soft-edged strokes in text-like rows over paper with a little noise. */
function scanGray(opts: { photo?: boolean; speckle?: number } = {}) {
  const r = rng(11);
  const g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const row = y % 40;
    const inLine = row >= 10 && row < 28 && y > 120 && y < H - 120;
    const line = Math.floor(y / 40);
    for (let x = 0; x < W; x++) {
      const glyph = inLine && x > 100 && x < W - 100 && hash((x >> 3) + 1000 * line, (y % 40) >> 3) < 0.55;
      g[y * W + x] = glyph ? 30 + r() * 25 : 249 - r() * 3;
    }
  }
  for (let k = 0; k < (opts.speckle ?? 0); k++) g[Math.floor(r() * g.length)] = 205;
  const soft = new Uint8Array(g.length);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = g[y * W + Math.max(0, x - 1)];
      const b = g[y * W + x];
      const c = g[y * W + Math.min(W - 1, x + 1)];
      soft[y * W + x] = (a + 2 * b + c) >> 2;
    }
  if (opts.photo) {
    for (let y = 700; y < 1400; y++)
      for (let x = 150; x < 1100; x++) {
        soft[y * W + x] = Math.round(130 + 100 * Math.sin(x / 33) * Math.cos(y / 41) + (r() - 0.5) * 24);
      }
  }
  return soft;
}

async function pdfWithImage(
  samples: Uint8Array,
  bits: 1 | 8,
  space: "DeviceGray" | "DeviceRGB" = "DeviceGray",
  drawWidthPt = 612,
) {
  const doc = await PDFDocument.create();
  const stream = doc.context.flateStream(samples, {
    Type: "XObject",
    Subtype: "Image",
    Width: W,
    Height: H,
    ColorSpace: space,
    BitsPerComponent: bits,
  });
  const ref = doc.context.register(stream);
  const page = doc.addPage([612, 792]);
  page.node.Resources()!.set(PDFName.of("XObject"), doc.context.obj({ Im0: ref }));
  page.node.addContentStream(
    doc.context.register(doc.context.flateStream(Buffer.from(`q ${drawWidthPt} 0 0 ${(drawWidthPt * H) / W} 0 0 cm /Im0 Do Q`))),
  );
  return doc.save();
}

/** A page of 20 random glyph shapes in rows, ink = 1: repeats like real text, never byte-aligned. */
function glyphPage() {
  const r = rng(21);
  const glyphs = Array.from({ length: 20 }, () => Array.from({ length: 6 * 9 }, () => (r() < 0.5 ? 1 : 0)));
  const ink = new Uint8Array(W * H);
  for (let line = 0; line < 38; line++) {
    for (let col = 0; col < 95; col++) {
      if (r() < 0.15) continue;
      const g = glyphs[Math.floor(r() * glyphs.length)];
      const x0 = 80 + col * 11 + Math.floor(r() * 2);
      const y0 = 100 + line * 38;
      for (let gy = 0; gy < 18; gy++)
        for (let gx = 0; gx < 6 * 1.5 && gx < 9; gx++) {
          if (g[Math.floor(gy / 2) * 6 + Math.floor(gx / 1.5)]) ink[(y0 + gy) * W + x0 + gx] = 1;
        }
    }
  }
  return ink;
}

function firstImage(doc: PDFDocument) {
  for (const [, o] of doc.context.enumerateIndirectObjects()) {
    if (o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")) return o;
  }
  throw new Error("no image");
}
const field = (s: PDFRawStream, k: string) => String(s.dict.get(PDFName.of(k)));

test("a grey scan becomes 1-bit JBIG2 at medium, with the same ink", async () => {
  const gray = scanGray({ speckle: 800 });
  const input = await pdfWithImage(gray, 8);
  const { bytes, stats } = await compressPdfBytes(input, COMPRESS_PLANS.medium, codec);
  expect(bytes.length).toBeLessThan(input.length * 0.1);
  expect(stats.images).toBe(1);

  const image = firstImage(await PDFDocument.load(bytes));
  expect(field(image, "Filter")).toBe("/JBIG2Decode");
  expect(field(image, "BitsPerComponent")).toBe("1");
  expect(field(image, "ColorSpace")).toBe("/DeviceGray");
  expect(field(image, "Width")).toBe(String(W)); // 1275 px over 8.5 in is only 150 dpi: no resample

  const back = decodeJbig2Generic(image.contents);
  expect(back.width).toBe(W);
  const expected = binarize(gray, W, H).ink;
  expect(Buffer.compare(back.pixels, expected)).toBe(0);
});

test("light leaves a grey scan lossless, only the 1-bit kind is recoded", async () => {
  const input = await pdfWithImage(scanGray(), 8);
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.light, codec);
  const image = firstImage(await PDFDocument.load(bytes));
  expect(field(image, "Filter")).not.toBe("/JBIG2Decode");
  expect(field(image, "BitsPerComponent")).toBe("8");
});

test("a 1-bit image is re-coded: exactly at light, near-exactly with letter matching above", async () => {
  const ink = glyphPage();
  const input = await pdfWithImage(packGray1(ink, W, H), 1);
  for (const plan of [COMPRESS_PLANS.light, COMPRESS_PLANS.medium, COMPRESS_PLANS.heavy]) {
    const { bytes } = await compressPdfBytes(input, plan, codec);
    const image = firstImage(await PDFDocument.load(bytes));
    expect(field(image, "Filter")).toBe("/JBIG2Decode");
    const back = decodeJbig2Generic(image.contents);
    if (plan === COMPRESS_PLANS.light) {
      expect(Buffer.compare(back.pixels, ink)).toBe(0);
    } else {
      let off = 0;
      for (let i = 0; i < ink.length; i++) if (back.pixels[i] !== ink[i]) off++;
      expect(off / ink.reduce((n, v) => n + v, 0)).toBeLessThan(0.1);
    }
    expect(bytes.length).toBeLessThan(input.length * 0.8);
  }
  const check = unpackGray1(packGray1(ink, W, H), W, H);
  expect(Buffer.compare(check, ink)).toBe(0);
});

test("heavy halves a 300 dpi 1-bit scan, medium keeps it", async () => {
  const ink = glyphPage();
  // 1275 px across 306 pt is 300 dpi.
  const input = await pdfWithImage(packGray1(ink, W, H), 1, "DeviceGray", 306);
  const heavy = firstImage(await PDFDocument.load((await compressPdfBytes(input, COMPRESS_PLANS.heavy, codec)).bytes));
  expect(Number(field(heavy, "Width"))).toBeGreaterThan(600);
  expect(Number(field(heavy, "Width"))).toBeLessThan(680);
  expect(field(heavy, "Filter")).toBe("/JBIG2Decode");
  const medium = firstImage(await PDFDocument.load((await compressPdfBytes(input, COMPRESS_PLANS.medium, codec)).bytes));
  expect(field(medium, "Width")).toBe(String(W));
});

test("a halftone 1-bit image is never thinned out", async () => {
  const r = rng(4);
  const dots = new Uint8Array(W * H);
  for (let i = 0; i < dots.length; i++) dots[i] = r() < 0.5 ? 1 : 0;
  const input = await pdfWithImage(packGray1(dots, W, H), 1, "DeviceGray", 306);
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.heavy, codec);
  const image = firstImage(await PDFDocument.load(bytes));
  expect(field(image, "Width")).toBe(String(W));
});

test("a page with a photo keeps its grey tones", async () => {
  const input = await pdfWithImage(scanGray({ photo: true }), 8);
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.medium, codec);
  const image = firstImage(await PDFDocument.load(bytes));
  expect(field(image, "Filter")).not.toBe("/JBIG2Decode");
  expect(field(image, "BitsPerComponent")).toBe("8");
});

test("coloured ink is not flattened to black and white", async () => {
  const gray = scanGray();
  const rgb = new Uint8Array(W * H * 3);
  for (let p = 0; p < W * H; p++) {
    const v = gray[p];
    rgb[p * 3] = Math.min(255, v + (255 - v) * 0.0);
    rgb[p * 3 + 1] = v * 0.2;
    rgb[p * 3 + 2] = v * 0.2 + (255 - v) * 0.8;
  }
  const input = await pdfWithImage(rgb, 8, "DeviceRGB");
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.medium, codec);
  const image = firstImage(await PDFDocument.load(bytes));
  expect(field(image, "Filter")).not.toBe("/JBIG2Decode");
});

test("the size ladder reaches JBIG2 for scans", async () => {
  const input = await pdfWithImage(scanGray(), 8);
  const result = await compressPdfToTarget(input, 60_000, codec);
  expect(result.fit).toBe(true);
  expect(result.bytes.length).toBeLessThanOrEqual(60_000);
});

test("luma helper agrees with the engine's reading of grey", () => {
  const px = { data: new Uint8ClampedArray([100, 100, 100, 255]), width: 1, height: 1 };
  expect(lumaOf(px)[0]).toBeGreaterThan(97);
  expect(lumaOf(px)[0]).toBeLessThan(101);
});
