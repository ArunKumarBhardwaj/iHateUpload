import type { JpegQuality } from "@/lib/tool-options";

/**
 * iOS ≤ 17 caps a single canvas at 4096×4096 / 16.7 M pixels. Crossing it
 * paints a blank canvas and does not throw. Stay under that on every engine
 * rather than sniff the OS. iOS 18 raised the cap; we still target the lower
 * one because 28% of visitors are on iOS and we cannot see the version.
 */
export const CANVAS_MAX_EDGE = 4096;
export const CANVAS_MAX_PIXELS = 16_777_216;

export function clampCanvasSize(width: number, height: number) {
  const longest = Math.max(width, height, 1);
  const pixels = Math.max(width * height, 1);
  const scale = Math.min(
    1,
    CANVAS_MAX_EDGE / longest,
    Math.sqrt(CANVAS_MAX_PIXELS / pixels),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

export type PageRenderPlan = {
  width: number;
  height: number;
  /** The pdf.js scale that fills exactly width by height. */
  scale: number;
  capped: boolean;
  /** DPI actually reached once the canvas limit is applied. */
  effectiveDpi: number;
};

/** Pixels a page gets at `dpi`, after the canvas limit. Sizes are in points. */
export function planPageRender(
  widthPt: number,
  heightPt: number,
  dpi: number,
): PageRenderPlan {
  const wanted = dpi / 72;
  const box = clampCanvasSize(widthPt * wanted, heightPt * wanted);
  const scale = (wanted * box.width) / Math.max(widthPt * wanted, 1);
  return {
    width: box.width,
    height: box.height,
    scale,
    capped: box.scale < 1,
    effectiveDpi: Math.round(dpi * box.scale),
  };
}

export function pageRenderNote(
  pageNumber: number,
  plan: PageRenderPlan,
  dpi: number,
): string | undefined {
  if (!plan.capped) return undefined;
  return `Page ${pageNumber} is large, so it was saved at ${plan.effectiveDpi} DPI (${plan.width} × ${plan.height} px) instead of ${dpi}.`;
}

export const JPEG_QUALITIES: {
  id: JpegQuality;
  title: string;
  value: number;
}[] = [
  { id: "small", title: "Smaller", value: 0.6 },
  { id: "balanced", title: "Balanced", value: 0.85 },
  { id: "best", title: "Best", value: 0.95 },
];

export function jpegQualityValue(id: JpegQuality): number {
  return JPEG_QUALITIES.find((q) => q.id === id)?.value ?? 0.85;
}
