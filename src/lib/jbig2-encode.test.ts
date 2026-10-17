import { expect, test } from "bun:test";

import { decodeJbig2Generic } from "./jbig2-decode.testutil";
import { encodeJbig2 } from "./jbig2-encode";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Blobs and strokes, so runs, edges, and repeated rows all occur. */
function inky(width: number, height: number, seed = 1) {
  const r = rng(seed);
  const px = new Uint8Array(width * height);
  for (let k = 0; k < (width * height) / 120; k++) {
    const x0 = Math.floor(r() * width);
    const y0 = Math.floor(r() * height);
    const w = 1 + Math.floor(r() * 9);
    const h = 1 + Math.floor(r() * 5);
    for (let y = y0; y < Math.min(height, y0 + h); y++)
      for (let x = x0; x < Math.min(width, x0 + w); x++) px[y * width + x] = 1;
  }
  return px;
}

function roundTrip(px: Uint8Array, width: number, height: number) {
  const stream = encodeJbig2(px, width, height);
  const back = decodeJbig2Generic(stream);
  expect(back.width).toBe(width);
  expect(back.height).toBe(height);
  expect(Buffer.compare(back.pixels, px)).toBe(0);
  return stream;
}

test("generic region round-trips textured bitmaps of odd sizes", () => {
  for (const [w, h, seed] of [[1, 1, 1], [7, 5, 2], [64, 64, 3], [333, 211, 4], [1000, 37, 5]] as const) {
    roundTrip(inky(w, h, seed), w, h);
  }
});

test("blank, solid, and checkerboard pages survive", () => {
  const w = 300;
  const h = 200;
  roundTrip(new Uint8Array(w * h), w, h);
  roundTrip(new Uint8Array(w * h).fill(1), w, h);
  const board = new Uint8Array(w * h);
  for (let i = 0; i < board.length; i++) board[i] = ((i % w) + Math.floor(i / w)) & 1;
  roundTrip(board, w, h);
});

test("a blank page costs next to nothing", () => {
  const stream = roundTrip(new Uint8Array(2550 * 3300), 2550, 3300);
  expect(stream.length).toBeLessThan(120);
});

test("repeated rows are predicted, not re-coded", () => {
  const w = 800;
  const h = 400;
  const px = new Uint8Array(w * h);
  const line = inky(w, 1, 9);
  for (let y = 0; y < h; y++) px.set(line, y * w);
  const tall = roundTrip(px, w, h).length;
  const one = roundTrip(line, w, 1).length;
  expect(tall).toBeLessThan(one + 200);
});
