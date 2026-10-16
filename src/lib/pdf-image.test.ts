import { expect, test } from "bun:test";

import {
  JPEG_QUALITIES,
  jpegQualityValue,
  pageRenderNote,
  LARGE_CANVAS,
  pickCanvasLimits,
  planPageRender,
  SAFE_CANVAS,
} from "./pdf-image";
import { PDF_IMAGE_DPIS, initialOptions } from "./tool-options";

// US Letter in points.
const W = 612;
const H = 792;

test("output pixels follow the DPI for a Letter page", () => {
  const at = (dpi: number) => {
    const plan = planPageRender(W, H, dpi);
    return [plan.width, plan.height, plan.capped];
  };
  expect(at(72)).toEqual([612, 792, false]);
  expect(at(150)).toEqual([1275, 1650, false]);
  expect(at(300)).toEqual([2550, 3300, false]);
});

test("600 DPI on a Letter page is capped and says what it got", () => {
  const plan = planPageRender(W, H, 600);
  expect(plan.capped).toBe(true);
  expect(Math.max(plan.width, plan.height)).toBeLessThanOrEqual(4096);
  expect(plan.width * plan.height).toBeLessThanOrEqual(16_777_216);
  expect(plan.effectiveDpi).toBeLessThan(600);
  expect(plan.effectiveDpi).toBeGreaterThan(300);
  // The pdf.js scale matches the pixels it will draw into.
  expect(plan.scale * W).toBeCloseTo(plan.width, 0);
  const note = pageRenderNote(3, plan, 600);
  expect(note).toContain("Page 3");
  expect(note).toContain("600");
  expect(note).toContain(`${plan.effectiveDpi}`);
});

test("a small page keeps the full 600 DPI and has no note", () => {
  const plan = planPageRender(300, 300, 600);
  expect(plan.capped).toBe(false);
  expect(plan.width).toBe(2500);
  expect(plan.effectiveDpi).toBe(600);
  expect(pageRenderNote(1, plan, 600)).toBeUndefined();
});

test("DPI choices are 72 / 150 / 300 / 600 with 150 as the default", () => {
  expect(PDF_IMAGE_DPIS.map((d) => d.id)).toEqual([72, 150, 300, 600]);
  const options = initialOptions("pdf-image");
  expect(options).toMatchObject({
    kind: "pdf-image",
    dpi: 150,
    range: "",
    format: "jpg",
  });
  expect(initialOptions("pdf-png")).toMatchObject({ format: "png" });
});

test("JPEG quality steps get smaller, and Balanced is the default", () => {
  const [small, balanced, best] = JPEG_QUALITIES.map((q) =>
    jpegQualityValue(q.id),
  );
  expect(small).toBeLessThan(balanced);
  expect(balanced).toBeLessThan(best);
  expect(best).toBeLessThanOrEqual(1);
  expect(JPEG_QUALITIES.map((q) => q.id)).toEqual(["small", "balanced", "best"]);
  expect(initialOptions("pdf-image")).toMatchObject({ quality: "balanced" });
});

const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";

test("cap decision: iPhone and iPad stay conservative, desktops go large", () => {
  expect(
    pickCanvasLimits({ userAgent: IPHONE, platform: "iPhone", maxTouchPoints: 5 }),
  ).toEqual(SAFE_CANVAS);
  // iPadOS Safari reports a Mac user agent but has touch points.
  expect(
    pickCanvasLimits({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 5 }),
  ).toEqual(SAFE_CANVAS);
  expect(
    pickCanvasLimits({ userAgent: MAC, platform: "MacIntel", maxTouchPoints: 0 }),
  ).toEqual(LARGE_CANVAS);
  expect(pickCanvasLimits(undefined)).toEqual(SAFE_CANVAS);
});

test("600 DPI on Letter is exact with the large limits, still capped with the safe ones", () => {
  const big = planPageRender(W, H, 600, LARGE_CANVAS);
  expect([big.width, big.height, big.capped, big.effectiveDpi]).toEqual([
    5100, 6600, false, 600,
  ]);
  expect(pageRenderNote(1, big, 600)).toBeUndefined();
  expect(planPageRender(W, H, 600, SAFE_CANVAS).capped).toBe(true);
  // A huge poster still gets capped by the large limits.
  expect(planPageRender(3000, 3000, 600, LARGE_CANVAS).capped).toBe(true);
});
