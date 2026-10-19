import { expect, test } from "bun:test";

import { mapPixel } from "./colour";

test("invert flips every channel", () => {
  expect(mapPixel("invert", 255, 255, 255)).toEqual([0, 0, 0]);
  expect(mapPixel("invert", 10, 200, 30)).toEqual([245, 55, 225]);
});

test("grayscale gives equal channels at the luma", () => {
  const [r, g, b] = mapPixel("grayscale", 255, 0, 0);
  expect(r).toBe(g);
  expect(g).toBe(b);
  expect(r).toBe(54);
});

test("sepia keeps black dark and makes white warm", () => {
  expect(mapPixel("sepia", 0, 0, 0)).toEqual([0, 0, 0]);
  const [r, g, b] = mapPixel("sepia", 255, 255, 255);
  expect(r).toBeGreaterThan(g);
  expect(g).toBeGreaterThan(b);
});

test("dark turns white paper into a soft dark and black text into soft light", () => {
  const paper = mapPixel("dark", 255, 255, 255);
  const ink = mapPixel("dark", 0, 0, 0);
  expect(Math.max(...paper)).toBeLessThan(60);
  expect(Math.min(...ink)).toBeGreaterThan(200);
});

test("dark keeps hues: a blue stays bluish, not orange", () => {
  const [r, , b] = mapPixel("dark", 30, 70, 200);
  expect(b).toBeGreaterThan(r);
});
