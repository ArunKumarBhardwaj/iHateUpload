import { expect, test } from "bun:test";

import {
  hitTextRun,
  mergeTextRuns,
  ocrWordsToRuns,
  pdfJsItemsToRuns,
  textMarkBox,
} from "./pdf-edit-runs";

test("pdf.js items become page-ratio runs", () => {
  const runs = pdfJsItemsToRuns(
    [
      { str: "ATHARV", transform: [10, 0, 0, 10, 20, 80], width: 60, height: 10 },
      { str: "  ", transform: [10, 0, 0, 10, 0, 0], width: 4, height: 10 },
    ],
    200,
    100,
    (x, y) => ({ x, y: 100 - y }),
  );
  expect(runs).toEqual([
    { text: "ATHARV", x: 20 / 200, y: 10 / 100, w: 60 / 200, h: 10 / 100 },
  ]);
});

test("neighboring items on one line merge", () => {
  const merged = mergeTextRuns([
    { text: "ATHARV", x: 0.1, y: 0.2, w: 0.12, h: 0.02 },
    { text: "ENTERPRISES", x: 0.232, y: 0.201, w: 0.2, h: 0.02 },
    { text: "BHOPAL", x: 0.1, y: 0.28, w: 0.14, h: 0.02 },
  ]);
  expect(merged).toHaveLength(2);
  expect(merged[0].text).toBe("ATHARV ENTERPRISES");
  expect(merged[0].x).toBeCloseTo(0.1);
  expect(merged[0].y).toBeCloseTo(0.2);
  expect(merged[0].w).toBeCloseTo(0.332);
  expect(merged[0].h).toBeCloseTo(0.021);
  expect(merged[1]).toEqual({ text: "BHOPAL", x: 0.1, y: 0.28, w: 0.14, h: 0.02 });
});

test("hit picks the smallest run under the pointer", () => {
  const runs = [
    { text: "wide", x: 0.1, y: 0.1, w: 0.5, h: 0.2 },
    { text: "cell", x: 0.12, y: 0.12, w: 0.1, h: 0.04 },
  ];
  expect(hitTextRun(runs, 0.15, 0.14)?.text).toBe("cell");
  expect(hitTextRun(runs, 0.02, 0.14)).toBeNull();
});

test("textMarkBox pads the run so the cover hides ink", () => {
  const box = textMarkBox({ text: "GSTIN", x: 0.2, y: 0.3, w: 0.1, h: 0.02 });
  expect(box.x).toBeLessThan(0.2);
  expect(box.y).toBeLessThan(0.3);
  expect(box.w).toBeGreaterThan(0.1);
  expect(box.h).toBeGreaterThan(0.02);
  expect(box.fontSize).toBeCloseTo(0.018);
});

test("OCR word boxes become page-ratio runs", () => {
  const runs = ocrWordsToRuns(
    [
      { text: "ATHARV", bbox: { x0: 20, y0: 40, x1: 80, y1: 56 } },
      { text: "  ", bbox: { x0: 0, y0: 0, x1: 1, y1: 1 } },
    ],
    200,
    100,
  );
  expect(runs).toEqual([
    { text: "ATHARV", x: 0.1, y: 0.4, w: 0.3, h: 0.16 },
  ]);
});

test("text turned 90 degrees keeps a box that wraps the turned glyphs", () => {
  // Baseline runs up the page (0,1); glyph "up" points left (-1,0).
  const runs = pdfJsItemsToRuns(
    [{ str: "Turned", transform: [0, 10, -10, 0, 50, 20], width: 60, height: 10 }],
    200,
    100,
    (x, y) => ({ x, y: 100 - y }),
  );
  expect(runs).toHaveLength(1);
  expect(runs[0].x).toBeCloseTo(40 / 200);
  expect(runs[0].w).toBeCloseTo(10 / 200);
  expect(runs[0].y).toBeCloseTo(20 / 100);
  expect(runs[0].h).toBeCloseTo(60 / 100);
});
