import { expect, test } from "bun:test";

import type { PathShape } from "./lines";
import { buildShapes, type ShapeContext } from "./shapes";

const ctx: ShapeContext = {
  width: 720,
  height: 405,
  tables: [],
  bullets: [],
  used: { usedRules: [], usedFills: [] },
};

const rect = (x0: number, y0: number, x1: number, y1: number, extra: Partial<PathShape>): PathShape => ({
  segs: [
    { op: "M", pts: [x0, y0] },
    { op: "L", pts: [x1, y0] },
    { op: "L", pts: [x1, y1] },
    { op: "L", pts: [x0, y1] },
    { op: "Z", pts: [] },
  ],
  width: 0,
  behind: false,
  ...extra,
});

test("a coloured full-page fill, like a slide background, is kept behind the text", () => {
  const { shapes } = buildShapes([rect(0, 0, 720, 405, { fill: "1e293b" })], ctx);
  expect(shapes).toHaveLength(1);
  expect(shapes[0]).toMatchObject({ kind: "rect", fill: "1E293B", behind: true, w: 720, h: 405 });
});

test("white and near-white full-page fills are dropped as paper colour", () => {
  expect(buildShapes([rect(0, 0, 720, 405, { fill: "ffffff" })], ctx).shapes).toHaveLength(0);
  expect(buildShapes([rect(0, 0, 720, 405, { fill: "f0f0f0" })], ctx).shapes).toHaveLength(0);
});

test("a saturated coloured page background is kept", () => {
  expect(buildShapes([rect(0, 0, 720, 405, { fill: "0f766e" })], ctx).shapes[0]).toMatchObject({ behind: true });
});

test("a stroked page frame keeps its outline", () => {
  const { shapes } = buildShapes([rect(10, 10, 710, 395, { stroke: "000000", width: 1 })], ctx);
  expect(shapes[0]).toMatchObject({ kind: "rect", stroke: "000000", fill: undefined });
});
