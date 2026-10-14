import { expect, test } from "bun:test";

import { layoutDocument } from "./layout";
import { ocrBlocksToItems } from "./ocr";

const word = (text: string, x0: number, y0: number, x1: number, y1: number) => ({
  text,
  confidence: 90,
  bbox: { x0, y0, x1, y1 },
});

test("OCR words become text items in page points", () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              bbox: { x0: 200, y0: 200, x1: 600, y1: 240 },
              words: [word("Hello", 200, 200, 330, 240), word("there", 350, 200, 480, 240)],
            },
            {
              bbox: { x0: 200, y0: 260, x1: 500, y1: 300 },
              words: [word("again", 200, 260, 330, 300)],
            },
          ],
        },
      ],
    },
  ];
  const items = ocrBlocksToItems(blocks, 2, 792);
  expect(items.map((i) => i.str)).toEqual(["Hello", "there", "again"]);
  expect(items[0].x).toBe(100);
  expect(items[0].size).toBeGreaterThan(15);
  expect(items[0].size).toBeLessThan(24);
  expect(items[2].y).toBeGreaterThan(items[0].y);
  // two OCR lines of one paragraph flow back together
  const doc = layoutDocument([{ width: 612, height: 792, items, rules: [], images: [] }]);
  const text = doc.sections[0].blocks.map((b) =>
    b.type === "p" ? b.runs.map((r) => r.text).join("") : "",
  );
  expect(text).toEqual(["Hello there again"]);
});

test("junk low-confidence fragments are dropped", () => {
  const blocks = [
    {
      paragraphs: [
        {
          lines: [
            {
              bbox: { x0: 0, y0: 0, x1: 100, y1: 30 },
              words: [
                word("Real", 0, 0, 60, 30),
                { text: "|", confidence: 5, bbox: { x0: 70, y0: 0, x1: 74, y1: 30 } },
              ],
            },
          ],
        },
      ],
    },
  ];
  expect(ocrBlocksToItems(blocks, 1, 792).map((i) => i.str)).toEqual(["Real"]);
});
