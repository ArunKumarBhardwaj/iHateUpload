import { expect, test } from "bun:test";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";

import { cropPages } from "./crop";
import {
  boxToMargins,
  marginsToBox,
  reorderKeys,
  visualRatioToUser,
} from "./geometry";
import { DEFAULT_RESIZE, resizePages, sheetFor } from "./resize";

const crop = { x: 0, y: 0, width: 600, height: 800 };

test("a shown box maps to user space for every /Rotate", () => {
  // Top-left quarter of the shown page.
  const b = { x: 0, y: 0, w: 0.5, h: 0.25 };
  expect(visualRatioToUser(b, crop, 0)).toEqual({ x: 0, y: 600, width: 300, height: 200 });
  // Shown 90: the shown top-left is the user bottom-left.
  expect(visualRatioToUser(b, crop, 90)).toEqual({ x: 0, y: 0, width: 150, height: 400 });
  // Shown 180: top-left is user top-right.
  expect(visualRatioToUser(b, crop, 180)).toEqual({ x: 300, y: 0, width: 300, height: 200 });
  // Shown 270: top-left is user top-right.
  expect(visualRatioToUser(b, crop, 270)).toEqual({ x: 450, y: 400, width: 150, height: 400 });
});

test("crop honours an offset crop box", async () => {
  const doc = await PDFDocument.create();
  const p = doc.addPage([600, 800]);
  p.setCropBox(100, 100, 400, 400);
  cropPages(doc, () => ({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }));
  const box = p.getCropBox();
  expect(box).toEqual({ x: 200, y: 200, width: 200, height: 200 });
});

test("margins round trip", () => {
  const box = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 };
  const m = boxToMargins(box, 600, 800);
  expect(m.left).toBeCloseTo(60);
  expect(m.bottom).toBeCloseTo(800 * 0.4);
  const back = marginsToBox(m, 600, 800);
  expect(back.w).toBeCloseTo(0.5);
  expect(back.h).toBeCloseTo(0.4);
});

test("reorderKeys moves groups before an index", () => {
  expect(reorderKeys(["a", "b", "c", "d"], ["a"], 3)).toEqual(["b", "c", "a", "d"]);
  expect(reorderKeys(["a", "b", "c", "d"], ["d", "b"], 0)).toEqual(["b", "d", "a", "c"]);
  expect(reorderKeys(["a", "b", "c"], ["b"], 2)).toEqual(["a", "b", "c"]);
});

test("resize: auto keeps each page's orientation, rotated pages come out upright", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  const wide = doc.addPage([600, 400]);
  wide.setRotation(degrees(90));
  const out = await resizePages(doc, { ...DEFAULT_RESIZE, size: "letter" });
  expect(out.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  // The 600x400 page shown rotated is 400 wide and 600 tall: portrait.
  expect(out.getPage(1).getSize()).toEqual({ width: 612, height: 792 });
  expect(sheetFor({ ...DEFAULT_RESIZE, orientation: "landscape" }, { width: 1, height: 2 })[0]).toBeGreaterThan(800);
});

test("resize: only chosen pages change; scale off keeps content size", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  doc.addPage([400, 600]);
  const out = await resizePages(doc, { ...DEFAULT_RESIZE, pages: [1], scale: false });
  expect(out.getPage(0).getSize()).toEqual({ width: 400, height: 600 });
  expect(out.getPage(1).getSize().width).toBeCloseTo(595.28);
});

test("custom size converts units", async () => {
  const doc = await PDFDocument.create();
  doc.addPage([400, 600]);
  const out = await resizePages(doc, { ...DEFAULT_RESIZE, size: "custom", width: 5, height: 7, unit: "in" });
  expect(out.getPage(0).getSize()).toEqual({ width: 360, height: 504 });
});
