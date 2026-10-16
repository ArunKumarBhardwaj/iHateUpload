import { describe, expect, test } from "bun:test";

import { charAccuracy, commentsScore } from "./score-real";
import { documentSimilarity, pageSimilarity, resizeGrey, ssim, type Grey } from "./visual";

const page = (w: number, h: number, paint: (x: number, y: number) => number): Grey => {
  const data = new Float64Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = paint(x, y);
  return { w, h, data };
};
/** White page with `lines` dark text-like bars starting at y0. */
const lined = (w: number, h: number, y0: number, lines: number) => {
  const k = w / 400;
  return page(w, h, (x, y) => (x > w * 0.1 && x < w * 0.9 && y >= y0 && y < y0 + lines * 20 * k && ((y - y0) % (20 * k)) < 8 * k ? 30 : 255));
};

describe("visual similarity", () => {
  test("identical pages score 1", () => {
    const a = lined(400, 520, 40, 20);
    expect(pageSimilarity(a, a)).toBeCloseTo(1, 5);
  });
  test("a blank page against a text page scores near 0", () => {
    expect(pageSimilarity(lined(400, 520, 40, 20), page(400, 520, () => 255))).toBeLessThan(0.3);
  });
  test("a small shift scores higher than a half-page shift", () => {
    const base = lined(400, 520, 40, 20);
    const near = pageSimilarity(base, lined(400, 520, 44, 20));
    const far = pageSimilarity(base, lined(400, 520, 210, 20));
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0.25);
  });
  test("is independent of render resolution", () => {
    const s = pageSimilarity(lined(400, 520, 40, 20), lined(800, 1040, 80, 20));
    expect(s).toBeGreaterThan(0.85);
  });
  test("resize keeps the mean grey", () => {
    const g = page(100, 100, (x) => (x < 50 ? 0 : 200));
    const r = resizeGrey(g, 10, 10);
    expect(r.data.reduce((a, b) => a + b, 0) / 100).toBeCloseTo(100, 5);
  });
  test("ssim rejects different sizes", () => {
    expect(() => ssim(page(8, 8, () => 0), page(16, 8, () => 0))).toThrow();
  });
  test("a missing converted page scores 0 for that page and extra pages are reported", () => {
    const a = lined(400, 520, 40, 10);
    const r = documentSimilarity([a, a], [a]);
    expect(r.pages[0]).toBeCloseTo(1, 5);
    expect(r.pages[1]).toBe(0);
    expect(r.score).toBeCloseTo(0.5, 2);
    expect(documentSimilarity([a], [a, a]).pageDelta).toBe(1);
  });
});

describe("char accuracy and comments", () => {
  test("char F1 ignores spacing and order", () => {
    expect(charAccuracy(["欢迎来到图书馆"], ["图书馆", "欢迎来到"])).toBe(1);
  });
  test("char F1 drops with missing text", () => {
    expect(charAccuracy(["欢迎来到图书馆"], ["欢迎"])).toBeLessThan(0.6);
  });
  test("comments need roughly all their words", () => {
    expect(commentsScore(["Check the water access"], ["check the water access please"])).toBe(1);
    expect(commentsScore(["Check the water access"], [])).toBe(0);
    expect(commentsScore(["a b c d e"], ["x y"])).toBe(0);
  });
});
