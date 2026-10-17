import { applyFilter, type Filtered } from "./filters";
import { documentAspect, downscale, quadSize, rotateImage, scaleQuad, warpPerspective } from "./geometry";
import type { Quad, RGBAImage, ScanFilter, ScanRotation } from "./types";

export type RenderSettings = {
  /** 0..1 of the photo; null keeps the whole frame. */
  corners: Quad | null;
  rotate: ScanRotation;
  filter: ScanFilter;
  brightness: number;
  contrast: number;
  /** Longest side of the result in pixels. */
  maxSide: number;
};

/** Longest side by filter: 1-bit pages can afford 300 dpi on A4. */
export function finalMaxSide(filter: ScanFilter) {
  return filter === "bw" ? 3300 : 2400;
}

/**
 * Crops, flattens perspective, turns and filters one photo. Pure pixel work,
 * so it runs the same in a worker, inline, or in tests.
 */
export function renderScanPage(source: RGBAImage, s: RenderSettings): Filtered {
  let flat: RGBAImage;
  if (s.corners) {
    const quad = scaleQuad(s.corners, source.width, source.height);
    const size = quadSize(quad);
    const aspect = documentAspect(quad, source.width, source.height);
    const rw = size.width;
    const rh = rw / aspect;
    const k = Math.min(1, s.maxSide / Math.max(rw, rh));
    const w = Math.max(8, Math.round(rw * k));
    const h = Math.max(8, Math.round(rh * k));
    flat = warpPerspective(source, quad, w, h);
  } else {
    flat = downscale(source, s.maxSide);
  }
  flat = rotateImage(flat, s.rotate);
  return applyFilter(flat, s.filter, s.brightness, s.contrast);
}
