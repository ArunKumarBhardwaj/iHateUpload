import { expect, test } from "bun:test";

import { eraseRules, keepShortWords } from "./ocr";

function page(w: number, h: number, paint: (x: number, y: number) => boolean) {
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (paint(x, y)) data.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 3);
  return data;
}
const darkAt = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4] < 100;

test("long horizontal and vertical rules are cleared and letters are not", () => {
  const w = 400;
  const h = 300;
  // a box 100..300 x 50..200, plus a short stroke like the bar of a letter
  const data = page(w, h, (x, y) => ((y === 50 || y === 200) && x >= 100 && x <= 300) || ((x === 100 || x === 300) && y >= 50 && y <= 200) || (y === 120 && x >= 150 && x < 160));
  expect(eraseRules(data, w, h)).toBeGreaterThan(500);
  expect(darkAt(data, w, 200, 50)).toBe(false);
  expect(darkAt(data, w, 100, 120)).toBe(false);
  expect(darkAt(data, w, 155, 120)).toBe(true);
});

test("unsure two-letter words are kept so units like in and qt survive", () => {
  const blocks = [{ paragraphs: [{ lines: [{ words: [{ text: "in", confidence: 12 }, { text: "|", confidence: 10 }, { text: "5", confidence: 20 }] }] }] }];
  const out = keepShortWords(blocks);
  expect(out[0].paragraphs![0].lines![0].words!.map((w) => w.confidence)).toEqual([60, 10, 60]);
});
