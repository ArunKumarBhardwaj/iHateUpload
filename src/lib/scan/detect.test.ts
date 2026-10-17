import { expect, test } from "bun:test";

import { detectDocument } from "./detect";
import { cameraQuad, makeSheet, photographSheet } from "./fixtures";
import { documentAspect, orderQuad, warpPerspective } from "./geometry";
import type { Quad } from "./types";

const SHEET = makeSheet(600, 800);
const QUAD: Quad = [
  { x: 210, y: 150 },
  { x: 880, y: 210 },
  { x: 840, y: 1010 },
  { x: 150, y: 930 },
];

function maxCornerError(found: Quad, truth: Quad, diag: number) {
  return Math.max(...truth.map((t, i) => Math.hypot(found[i].x - t.x, found[i].y - t.y))) / diag;
}

test("orderQuad sorts any corner order into tl, tr, br, bl", () => {
  const shuffled = [QUAD[2], QUAD[0], QUAD[3], QUAD[1]];
  expect(orderQuad(shuffled)).toEqual(QUAD);
});

for (const background of ["desk", "dark", "white"] as const) {
  test(`finds a tilted sheet on a ${background} background`, () => {
    const photo = photographSheet(SHEET, QUAD, {
      width: 1000,
      height: 1200,
      background,
      noise: 8,
      shade: 0.15,
    });
    const found = detectDocument(photo);
    expect(found.found).toBe(true);
    expect(maxCornerError(found.quad, QUAD, Math.hypot(1000, 1200))).toBeLessThan(0.02);
  });
}

test("a sheet filling the whole frame reports no crop", () => {
  const photo = photographSheet(
    SHEET,
    [
      { x: 0, y: 0 },
      { x: 600, y: 0 },
      { x: 600, y: 800 },
      { x: 0, y: 800 },
    ],
    { width: 600, height: 800 },
  );
  expect(detectDocument(photo).found).toBe(false);
});

test("flattening the detected corners gives the sheet back", () => {
  const cam = cameraQuad(210, 280, { yaw: -0.4, pitch: 0.3, roll: 0.12, dist: 430, focal: 900, width: 1000, height: 1200 });
  const photo = photographSheet(SHEET, cam, { width: 1000, height: 1200, noise: 6 });
  const found = detectDocument(photo);
  expect(found.found).toBe(true);
  const ratio = documentAspect(found.quad, 1000, 1200);
  expect(Math.abs(ratio / 0.75 - 1)).toBeLessThan(0.06);
  const flat = warpPerspective(photo, found.quad, 600, Math.round(600 / ratio));
  // The heading bar sits 6-10% down, starting 10% in.
  const row = Math.round(flat.height * 0.08);
  expect(flat.data[(row * flat.width + 120) * 4]).toBeLessThan(110);
  expect(flat.data[(Math.round(flat.height * 0.5) * flat.width + 580) * 4]).toBeGreaterThan(200);
});
