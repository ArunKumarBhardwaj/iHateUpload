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
    flat = trimEdges(warpPerspective(source, quad, w, h));
  } else {
    flat = downscale(source, s.maxSide);
  }
  flat = rotateImage(flat, s.rotate);
  return applyFilter(flat, s.filter, s.brightness, s.contrast);
}

/** Fixed share of each side always dropped: the traced outline is never exact. */
const TRIM = 0.015;
/** Most that darker-than-page edge lines may take off one side. */
const TRIM_MAX = 0.06;

function crop(img: RGBAImage, l: number, t: number, r: number, b: number): RGBAImage {
  const w = img.width - l - r;
  const h = img.height - t - b;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const from = ((y + t) * img.width + l) * 4;
    data.set(img.data.subarray(from, from + w * 4), y * w * 4);
  }
  return { data, width: w, height: h };
}

/**
 * Takes the leftover table off the edges of a flattened page: a small fixed
 * margin, then any further edge lines that are clearly darker than the paper.
 */
function trimEdges(img: RGBAImage): RGBAImage {
  const { width: w, height: h } = img;
  const luma = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return (img.data[i] * 77 + img.data[i + 1] * 150 + img.data[i + 2] * 29) >> 8;
  };
  let l = Math.max(1, Math.round(w * TRIM));
  let r = l;
  let t = Math.max(1, Math.round(h * TRIM));
  let b = t;
  // Paper level: the bright end of the middle of the page.
  const samples: number[] = [];
  for (let y = Math.floor(h * 0.2); y < h * 0.8; y += 4) {
    for (let x = Math.floor(w * 0.2); x < w * 0.8; x += 4) samples.push(luma(x, y));
  }
  samples.sort((a, c) => a - c);
  const paper = samples[Math.floor(samples.length * 0.85)] ?? 255;
  const dark = paper * 0.82;
  const col = (x: number) => {
    let n = 0;
    for (let y = t; y < h - b; y++) n += luma(x, y);
    return n / Math.max(1, h - t - b);
  };
  const row = (y: number) => {
    let n = 0;
    for (let x = l; x < w - r; x++) n += luma(x, y);
    return n / Math.max(1, w - l - r);
  };
  const maxX = Math.round(w * TRIM_MAX);
  const maxY = Math.round(h * TRIM_MAX);
  while (l < maxX && col(l) < dark) l++;
  while (r < maxX && col(w - 1 - r) < dark) r++;
  while (t < maxY && row(t) < dark) t++;
  while (b < maxY && row(h - 1 - b) < dark) b++;
  if (w - l - r < 8 || h - t - b < 8) return img;
  return crop(img, l, t, r, b);
}
