import { expect, test } from "bun:test";

import {
  JPEG_QUALITIES,
  jpegQualityValue,
  pageRenderNote,
  planPageRender,
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
