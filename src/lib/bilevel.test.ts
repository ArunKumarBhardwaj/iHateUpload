import { expect, test } from "bun:test";

import {
  binarize,
  isColorful,
  lumaOf,
  otsu,
  packGray1,
  shrinkLuma,
  unpackGray1,
} from "./bilevel";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Dark strokes on paper with soft edges, like a scanned text line stack. */
function scanText(width: number, height: number, opts: { paper?: number; shade?: number; speckle?: number } = {}) {
  const r = rng(3);
  const { paper = 250, shade = 0, speckle = 0 } = opts;
  const luma = new Uint8Array(width * height);
  const truth = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const line = Math.floor(y / 24);
    const inLine = y % 24 >= 6 && y % 24 < 18;
    for (let x = 0; x < width; x++) {
      const glyph = inLine && x > 10 && x < width - 10 && (x + line * 3) % 11 < 4;
      truth[y * width + x] = glyph ? 1 : 0;
      const bg = paper - shade * (x / width);
      luma[y * width + x] = Math.round(glyph ? 30 + r() * 20 : bg - r() * 3);
    }
  }
  for (let k = 0; k < speckle; k++) {
    const i = Math.floor(r() * luma.length);
    luma[i] = 200;
  }
  // One box blur pass makes anti-aliased edges.
  const out = new Uint8Array(luma.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let s = 0;
      let n = 0;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < width) {
          s += luma[y * width + xx];
          n++;
        }
      }
      out[y * width + x] = Math.round(s / n);
    }
  return { luma: out, truth };
}

function differing(a: Uint8Array, b: Uint8Array) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n / a.length;
}

test("Otsu splits two-tone histograms between the peaks", () => {
  const hist = new Array(256).fill(0);
  hist[30] = 1000;
  hist[240] = 9000;
  const t = otsu(hist);
  expect(t).toBeGreaterThanOrEqual(30);
  expect(t).toBeLessThan(240);
});

test("scanned text becomes ink samples that match the strokes", () => {
  const { luma, truth } = scanText(600, 480);
  const result = binarize(luma, 600, 480);
  expect(result.bilevel).toBe(true);
  expect(differing(result.ink, truth)).toBeLessThan(0.02);
});

test("light grey speckle is paper, not ink", () => {
  const { luma, truth } = scanText(600, 480, { speckle: 3000 });
  const result = binarize(luma, 600, 480);
  expect(result.bilevel).toBe(true);
  expect(differing(result.ink, truth)).toBeLessThan(0.02);
});

test("uneven lighting does not turn the shaded side into ink", () => {
  const { luma, truth } = scanText(800, 480, { paper: 250, shade: 110 });
  const result = binarize(luma, 800, 480);
  expect(result.bilevel).toBe(true);
  expect(differing(result.ink, truth)).toBeLessThan(0.03);
});

test("a photograph is not bilevel", () => {
  const r = rng(5);
  const w = 600;
  const h = 480;
  const luma = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      luma[y * w + x] = Math.round(128 + 90 * Math.sin(x / 40) * Math.cos(y / 55) + (r() - 0.5) * 20);
    }
  expect(binarize(luma, w, h).bilevel).toBe(false);
});

test("a small photo on a text page still keeps the page as it is", () => {
  const { luma } = scanText(1024, 1024);
  const r = rng(8);
  for (let y = 600; y < 900; y++)
    for (let x = 100; x < 500; x++) {
      luma[y * 1024 + x] = Math.round(120 + 100 * Math.sin(x / 20) * Math.cos(y / 30) + (r() - 0.5) * 20);
    }
  expect(binarize(luma, 1024, 1024).bilevel).toBe(false);
});

test("coloured ink is flagged so it keeps its colour", () => {
  const n = 64 * 64;
  const gray = { data: new Uint8ClampedArray(n * 4).fill(200), width: 64, height: 64 };
  expect(isColorful(gray)).toBe(false);
  const red = new Uint8ClampedArray(n * 4);
  for (let p = 0; p < n; p++) red.set([220, 30, 30, 255], p * 4);
  expect(isColorful({ data: red, width: 64, height: 64 })).toBe(true);
  expect(lumaOf({ data: red, width: 64, height: 64 })[0]).toBeLessThan(120);
});

test("shrinking luma averages boxes and keeps dimensions", () => {
  const luma = new Uint8Array(8 * 8).fill(255);
  for (let y = 0; y < 8; y++) luma[y * 8 + 3] = 0;
  const half = shrinkLuma(luma, 8, 8, 4, 4);
  expect(half.length).toBe(16);
  expect(half[0]).toBe(255);
  expect(half[1]).toBe(128);
  expect(shrinkLuma(luma, 8, 8, 8, 8)).toBe(luma);
});

test("1-bit packing round-trips and stores ink as 0", () => {
  const ink = new Uint8Array([1, 0, 0, 1, 1, 0, 0, 0, 1, 1]);
  const packed = packGray1(ink, 10, 1);
  expect(packed.length).toBe(2);
  expect(packed[0]).toBe(0b01100111);
  expect(Buffer.compare(unpackGray1(packed, 10, 1), ink)).toBe(0);
});
