import { expect, test } from "bun:test";

import { decodeJbig2 } from "./jbig2-decode.testutil";
import { encodeJbig2 } from "./jbig2-encode";
import { encodeJbig2Symbols } from "./jbig2-symbols";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

type Glyph = { w: number; h: number; px: Uint8Array };

/** A letter-like blob: a ring with a bar, so every shape is connected and distinct. */
function glyph(seed: number, w = 20, h = 26): Glyph {
  const r = rng(seed);
  const px = new Uint8Array(w * h);
  const thick = 3;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x < thick || y < thick || x >= w - thick || y >= h - thick;
      if (edge) px[y * w + x] = 1;
    }
  // Seeded bars make glyphs differ by more than noise.
  const bars = 1 + Math.floor(r() * 2);
  for (let b = 0; b < bars; b++) {
    const y0 = 4 + Math.floor(r() * (h - 12));
    for (let y = y0; y < y0 + 4; y++) for (let x = 0; x < w; x++) px[y * w + x] = 1;
  }
  const col = 3 + Math.floor(r() * (w - 9));
  if (r() < 0.6) for (let y = 0; y < h; y++) for (let x = col; x < col + 3; x++) px[y * w + x] = 1;
  return { w, h, px };
}

function page(glyphs: Glyph[], cols: number, rows: number, noise: number, seed = 1) {
  const r = rng(seed);
  const W = cols * 34 + 40;
  const H = rows * 44 + 40;
  const ink = new Uint8Array(W * H);
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const g = glyphs[(row * 7 + col * 3 + Math.floor(r() * 2)) % glyphs.length];
      const x0 = 20 + col * 34;
      const y0 = 20 + row * 44;
      for (let y = 0; y < g.h; y++)
        for (let x = 0; x < g.w; x++) {
          let v = g.px[y * g.w + x];
          // Flip pixels on the stroke boundary now and then, like scanner edge noise.
          const border =
            v !== (g.px[y * g.w + Math.min(g.w - 1, x + 1)] ?? 0) || v !== (g.px[Math.min(g.h - 1, y + 1) * g.w + x] ?? 0);
          if (border && r() < noise) v ^= 1;
          ink[(y0 + y) * W + x0 + x] = v;
        }
    }
  return { ink, W, H };
}

function diffShare(a: Uint8Array, b: Uint8Array) {
  let d = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) d++;
    if (a[i] || b[i]) n++;
  }
  return d / Math.max(n, 1);
}

test("identical letters round-trip exactly through the dictionary", () => {
  const glyphs = [1, 2, 3, 4, 5].map((s) => glyph(s));
  const { ink, W, H } = page(glyphs, 12, 8, 0);
  const stream = encodeJbig2Symbols(ink, W, H);
  expect(stream).not.toBeNull();
  const back = decodeJbig2(stream!);
  expect(back.width).toBe(W);
  expect(Buffer.compare(back.pixels, ink)).toBe(0);
  expect(stream!.length).toBeLessThan(encodeJbig2(ink, W, H).length * 0.6);
});

test("scanner-noisy repeats are matched without altering the shapes", () => {
  const glyphs = [1, 2, 3, 4, 5, 6].map((s) => glyph(s));
  const { ink, W, H } = page(glyphs, 14, 10, 0.12);
  const stream = encodeJbig2Symbols(ink, W, H);
  expect(stream).not.toBeNull();
  const back = decodeJbig2(stream!);
  expect(diffShare(back.pixels, ink)).toBeLessThan(0.1);
  expect(stream!.length).toBeLessThan(encodeJbig2(ink, W, H).length * 0.7);
});

test("letters that differ by a stroke are never merged", () => {
  const a = glyph(11);
  const b: Glyph = { ...a, px: a.px.slice() };
  // b gets a thick extra bar across the middle, the way e differs from c.
  for (let y = 10; y < 14; y++) for (let x = 0; x < b.w; x++) b.px[y * b.w + x] = 1;
  const { ink, W, H } = page([a, b], 12, 6, 0);
  const stream = encodeJbig2Symbols(ink, W, H)!;
  const back = decodeJbig2(stream);
  expect(Buffer.compare(back.pixels, ink)).toBe(0);
});

test("drawings and one-off marks stay lossless in the generic region", () => {
  const glyphs = [1, 2, 3].map((s) => glyph(s));
  const { ink, W, H } = page(glyphs, 10, 6, 0);
  // A big frame (not letter sized) and a lone mark.
  for (let x = 5; x < W - 5; x++) {
    ink[5 * W + x] = 1;
    ink[(H - 6) * W + x] = 1;
  }
  for (let y = 5; y < H - 5; y++) {
    ink[y * W + 5] = 1;
    ink[y * W + (W - 6)] = 1;
  }
  const stream = encodeJbig2Symbols(ink, W, H)!;
  expect(Buffer.compare(decodeJbig2(stream).pixels, ink)).toBe(0);
});

test("pages without repeated letters fall back to nothing", () => {
  const ink = new Uint8Array(200 * 200);
  for (let i = 0; i < 4; i++) for (let y = 10; y < 20; y++) for (let x = 10 + i * 40; x < 20 + i * 40; x++) ink[y * 200 + x] = 1;
  expect(encodeJbig2Symbols(ink, 200, 200)).toBeNull();
});
