import { expect, test } from "bun:test";

import {
  ghostTextPlacement,
  keepHelveticaWinAnsi,
  wordsFromOcrBlocks,
} from "./ocr-words";

test("null OCR blocks yield no overlay words", () => {
  expect(wordsFromOcrBlocks(null)).toEqual([]);
  expect(wordsFromOcrBlocks(undefined)).toEqual([]);
});

test("nested Tesseract blocks flatten to trimmed words", () => {
  expect(
    wordsFromOcrBlocks([
      {
        paragraphs: [
          {
            lines: [
              {
                words: [
                  { text: " Hello ", bbox: { x0: 10, y0: 20, x1: 40, y1: 36 } },
                  { text: "  ", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
                  { text: "PDF", bbox: { x0: 44, y0: 20, x1: 70, y1: 36 } },
                ],
              },
            ],
          },
        ],
      },
    ]),
  ).toEqual([
    { text: "Hello", bbox: { x0: 10, y0: 20, x1: 40, y1: 36 } },
    { text: "PDF", bbox: { x0: 44, y0: 20, x1: 70, y1: 36 } },
  ]);
});

test("keepHelveticaWinAnsi keeps Latin letters and drops Devanagari", () => {
  expect(keepHelveticaWinAnsi("café")).toBe("café");
  expect(keepHelveticaWinAnsi("Hello नमस्ते")).toBe("Hello ");
});

test("ghost text sits at the page-space word box", () => {
  expect(
    ghostTextPlacement(
      { x0: 10, y0: 20, x1: 50, y1: 40 },
      100,
      200,
      100,
      200,
    ),
  ).toEqual({
    x: 10,
    y: 160,
    size: 17,
    maxWidth: 40,
  });
});
