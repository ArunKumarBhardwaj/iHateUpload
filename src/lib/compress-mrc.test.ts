import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFRawStream, PDFRef } from "@cantoo/pdf-lib";

import { createWasmCodec } from "./compress-codec";
import { compressPdfBytes, type Pixels } from "./compress-engine";
import { COMPRESS_PLANS } from "./compress-plans";
import { splitScan } from "./compress-mrc";
import { decodeJbig2 } from "./jbig2-decode.testutil";

const codec = createWasmCodec(async (file) => WebAssembly.compile(readFileSync(`public/codecs/${file}`)));
const W = 1275; // letter at 150 dpi keeps the test quick
const H = 1650;

/** Cream paper, black text-like strokes, a blue pen line and a red stamp ring, with scanner noise. */
function colourScan(): Pixels {
  const data = new Uint8ClampedArray(W * H * 4);
  let s = 5;
  const noise = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 8;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    let c = [246, 241, 228];
    const line = y % 40;
    if (y > 100 && y < 1100 && line >= 12 && line < 26 && x > 90 && x < 1180 && ((x >> 3) * 31 + (y >> 3) * 17) % 7 < 4) c = [25, 25, 25];
    if (Math.abs(y - (1300 + 40 * Math.sin(x / 30))) < 3 && x > 700 && x < 1100) c = [30, 50, 170];
    const r = Math.hypot(x - 300, y - 1350);
    if (r > 120 && r < 130) c = [200, 30, 40];
    data[o] = c[0] + noise();
    data[o + 1] = c[1] + noise();
    data[o + 2] = c[2] + noise();
    data[o + 3] = 255;
  }
  return { data, width: W, height: H };
}

test("a colour scan splits into a sharp text mask and small colour layers", async () => {
  const layers = (await splitScan(colourScan(), { maskWidth: W, maskHeight: H, bgScale: 4, fgScale: 8, bgQuality: 60, fgQuality: 50, matchLetters: true }, codec))!;
  expect(layers).not.toBeNull();
  const mask = decodeJbig2(layers.mask.bytes);
  expect([mask.width, mask.height]).toEqual([W, H]);
  // Black text, the blue line and the red ring are all ink.
  const at = (x: number, y: number) => mask.pixels[y * W + x];
  expect(at(300 - 125, 1350)).toBe(1);
  expect(at(900, Math.round(1300 + 40 * Math.sin(900 / 30)))).toBe(1);
  expect(at(50, 50)).toBe(0);
  // Paper and ink colour cost little next to the mask.
  expect(layers.bg.bytes.length + layers.fg.bytes.length).toBeLessThan(40_000);
});

test("a colour scan page compresses to MRC: a form of paper and masked ink, far under JPEG", async () => {
  const src = colourScan();
  const jpeg = await codec.encodeJpeg(src, 85, false);
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  doc.addPage([612, 792]).drawImage(image, { x: 0, y: 0, width: 612, height: 792 });
  const input = await doc.save();
  const { bytes } = await compressPdfBytes(input, COMPRESS_PLANS.medium, codec);
  const out = await PDFDocument.load(bytes);
  const xobjects = out.getPage(0).node.Resources()!.lookup(PDFName.of("XObject")) as never as { entries(): [PDFName, PDFRef][] };
  const [[, ref]] = xobjects.entries();
  const form = out.context.lookup(ref) as PDFRawStream;
  expect(form.dict.get(PDFName.of("Subtype"))).toBe(PDFName.of("Form"));
  const inner = form.dict.lookup(PDFName.of("Resources")) as never as { lookup(n: PDFName): { entries(): [PDFName, PDFRef][] } };
  const layers = inner.lookup(PDFName.of("XObject")).entries().map(([, r]) => out.context.lookup(r) as PDFRawStream);
  const fg = layers.find((l) => l.dict.has(PDFName.of("Mask")))!;
  const mask = out.context.lookup(fg.dict.get(PDFName.of("Mask")) as PDFRef) as PDFRawStream;
  expect(mask.dict.get(PDFName.of("Filter"))).toBe(PDFName.of("JBIG2Decode"));
  expect(bytes.length).toBeLessThan(input.length / 4);
}, 30_000);

test("a photo is not split", async () => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let p = 0; p < W * H; p++) {
    data[p * 4] = (p % W) / 5;
    data[p * 4 + 1] = (p / W) / 7;
    data[p * 4 + 2] = 128 + 60 * Math.sin(p / 900);
    data[p * 4 + 3] = 255;
  }
  const layers = await splitScan({ data, width: W, height: H }, { maskWidth: W, maskHeight: H, bgScale: 4, fgScale: 8, bgQuality: 60, fgQuality: 50, matchLetters: true }, codec);
  expect(layers).toBeNull();
});
