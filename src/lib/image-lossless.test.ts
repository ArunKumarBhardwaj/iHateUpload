import { expect, test } from "bun:test";
import { unzlibSync } from "fflate";

import { commonColours, encodeLossless, looksDigital, paletteOf, pngFilter, snapToPalette, unpredict } from "./image-lossless";

const W = 120;
const H = 80;

function chart(): Uint8Array {
  const rgb = new Uint8Array(W * H * 3).fill(255);
  for (let y = 10; y < 70; y++) for (let x = 0; x < W; x++) {
    const c = x < 40 ? [66, 133, 244] : x < 80 ? [219, 68, 55] : [244, 180, 0];
    if (y > 70 - x / 2) rgb.set(c, (y * W + x) * 3);
  }
  return rgb;
}

function noisy(): Uint8Array {
  let s = 9;
  return Uint8Array.from({ length: W * H * 3 }, () => ((s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff) >> 16) & 255);
}

test("PNG filters undo exactly through the PDF predictor", () => {
  const rgb = noisy();
  const filtered = pngFilter(rgb, W * 3, 3);
  expect(unpredict(filtered, 15, 3, 8, W)).toEqual(rgb);
});

test("TIFF predictor 2 is undone", () => {
  const row = Uint8Array.from([10, 20, 30, 1, 1, 1, 2, 2, 2]);
  expect(Array.from(unpredict(row, 2, 3, 8, 3)!)).toEqual([10, 20, 30, 11, 21, 31, 13, 23, 33]);
});

test("a flat chart becomes a small palette image that decodes to the same pixels", () => {
  const rgb = chart();
  const l = encodeLossless(rgb, W, H, 3);
  expect(l.palette!.length / 3).toBe(4);
  expect(l.bitsPerComponent).toBe(2);
  let packed = unzlibSync(l.bytes);
  if (l.predictor) packed = unpredict(packed, 15, 1, l.bitsPerComponent, W)!;
  // Unpack 2-bit indices and look them up.
  const rowBytes = Math.ceil((W * 2) / 8);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const idx = (packed[y * rowBytes + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
    expect(Array.from(l.palette!.subarray(idx * 3, idx * 3 + 3))).toEqual(Array.from(rgb.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)));
  }
});

test("an RGB image that is all grey is stored as grey", () => {
  const rgb = new Uint8Array(W * H * 3);
  for (let p = 0; p < W * H; p++) rgb.fill((p * 37) & 255, p * 3, p * 3 + 3);
  const l = encodeLossless(rgb, W, H, 3);
  expect(l.gray).toBe(true);
  expect(l.channels).toBe(1);
});

test("screenshots look digital, noise does not", () => {
  expect(looksDigital(chart(), W, H, 3)).toBe(true);
  expect(looksDigital(noisy(), W, H, 3)).toBe(false);
});

test("palettes: exact up to 256 colours, snapping keeps flat colour flat", () => {
  expect(paletteOf(chart(), W * H, 3)!.length).toBe(4);
  expect(paletteOf(noisy(), W * H, 3)).toBeNull();
  const pal = commonColours(chart(), W * H, 3, 4);
  const blurred = chart().map((v, i) => (i % 7 === 0 ? Math.max(0, v - 3) : v));
  expect(paletteOf(snapToPalette(blurred, W * H, 3, pal), W * H, 3)!.length).toBeLessThanOrEqual(4);
});
