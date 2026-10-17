import { expect, test } from "bun:test";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";

import { boxToPlacement, boxToUserRect, pageFrame } from "./page-geometry";

const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

async function page(rotation: number) {
  const doc = await PDFDocument.create();
  const p = doc.addPage([400, 600]);
  p.setRotation(degrees(rotation));
  return p;
}

test("an upright page maps top-left ratios to PDF space", async () => {
  const placed = boxToPlacement(pageFrame(await page(0)), box);
  expect(placed.x).toBeCloseTo(40);
  expect(placed.y).toBeCloseTo(600 - 0.3 * 600);
  expect(placed.width).toBeCloseTo(120);
  expect(placed.height).toBeCloseTo(60);
  expect(placed.rotate).toBe(0);
});

test("a page turned 90 degrees lands the box where it is seen", async () => {
  const frame = pageFrame(await page(90));
  const r = boxToUserRect(frame, { x: 0, y: 0, w: 0.5, h: 0.5 });
  // The seen top-left quarter of a clockwise-turned page is the unturned bottom-left.
  expect([r.x0, r.y0, r.x1, r.y1].map(Math.round)).toEqual([0, 0, 200, 300]);
  expect(boxToPlacement(frame, box).width).toBeCloseTo(0.3 * 600);
});

test("turning 180 and 270 put the box in the right corners", async () => {
  const r180 = boxToUserRect(pageFrame(await page(180)), { x: 0, y: 0, w: 0.5, h: 0.5 });
  expect([r180.x0, r180.y0, r180.x1, r180.y1].map(Math.round)).toEqual([200, 0, 400, 300]);
  const r270 = boxToUserRect(pageFrame(await page(270)), { x: 0, y: 0, w: 0.5, h: 0.5 });
  expect([r270.x0, r270.y0, r270.x1, r270.y1].map(Math.round)).toEqual([200, 300, 400, 600]);
});
