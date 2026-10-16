import type { JpegQuality } from "@/lib/tool-options";

export type CanvasLimits = { maxEdge: number; maxPixels: number };

/**
 * iOS ≤ 17 caps a single canvas at 4096×4096 / 16.7 M pixels. Crossing it
 * paints a blank canvas and does not throw. This is the default everywhere.
 */
export const SAFE_CANVAS: CanvasLimits = {
  maxEdge: 4096,
  maxPixels: 16_777_216,
};

/** Chrome, Firefox and desktop Safari all allow this much. */
export const LARGE_CANVAS: CanvasLimits = {
  maxEdge: 16384,
  maxPixels: 268_435_456,
};

export type DeviceHints = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

/**
 * Large canvases only where the browser is known to take them. Any iPhone or
 * iPad (iPadOS reports a Mac user agent, told apart by touch) stays on the safe
 * limit because the OS version cannot be read reliably.
 */
export function pickCanvasLimits(hints: DeviceHints | undefined): CanvasLimits {
  if (!hints) return SAFE_CANVAS;
  if (/iPhone|iPad|iPod/.test(hints.userAgent)) return SAFE_CANVAS;
  if (/Mac/.test(hints.platform) && hints.maxTouchPoints > 1) return SAFE_CANVAS;
  if (/Android|Mobile/.test(hints.userAgent)) return SAFE_CANVAS;
  return LARGE_CANVAS;
}

export function currentCanvasLimits(): CanvasLimits {
  if (typeof navigator === "undefined") return SAFE_CANVAS;
  return pickCanvasLimits({
    userAgent: navigator.userAgent,
    platform: navigator.platform ?? "",
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

/** Draws one pixel in the far corner and reads it back. A canvas the browser refused reads as empty. */
export function canvasHoldsSize(width: number, height: number): boolean {
  const canvas = document.createElement("canvas");
  try {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return false;
    ctx.fillStyle = "#010203";
    ctx.fillRect(width - 1, height - 1, 1, 1);
    const px = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    return px[0] === 1 && px[1] === 2 && px[2] === 3 && px[3] === 255;
  } catch {
    return false;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function clampCanvasSize(
  width: number,
  height: number,
  limits: CanvasLimits = SAFE_CANVAS,
) {
  const longest = Math.max(width, height, 1);
  const pixels = Math.max(width * height, 1);
  const scale = Math.min(
    1,
    limits.maxEdge / longest,
    Math.sqrt(limits.maxPixels / pixels),
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
  limits: CanvasLimits = SAFE_CANVAS,
): PageRenderPlan {
  const wanted = dpi / 72;
  const box = clampCanvasSize(widthPt * wanted, heightPt * wanted, limits);
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
