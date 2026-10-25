import type { CropFraming, Rect } from "./types";

/**
 * The byte range to aim for. Notices rarely say whether 1 KB is 1000 or 1024
 * bytes, so the floor uses 1024 and the cap uses 1000: a file inside this band
 * passes under either reading.
 */
export function byteBand(slot: { minKb: number; maxKb: number }): { min: number; max: number } {
  return { min: slot.minKb * 1024, max: slot.maxKb * 1000 };
}

export type QualityResult = {
  status: "ok" | "under-min" | "over-max";
  quality: number;
  size: number;
};

const TOP = 0.98;
const BOTTOM = 0.05;

/**
 * Finds the highest JPEG quality whose file fits under the cap. `under-min`
 * means the best fit is still below the floor (the caller pads it);
 * `over-max` means even the lowest quality is too big.
 */
export async function searchQuality(
  encode: (quality: number) => Promise<number>,
  band: { min: number; max: number },
): Promise<QualityResult> {
  const top = await encode(TOP);
  if (top <= band.max) {
    return { status: top >= band.min ? "ok" : "under-min", quality: TOP, size: top };
  }
  const bottom = await encode(BOTTOM);
  if (bottom > band.max) return { status: "over-max", quality: BOTTOM, size: bottom };

  let low = BOTTOM;
  let lowSize = bottom;
  let high = TOP;
  for (let i = 0; i < 9; i++) {
    const quality = (low + high) / 2;
    const size = await encode(quality);
    if (size <= band.max) {
      low = quality;
      lowSize = size;
    } else {
      high = quality;
    }
  }
  return { status: lowSize >= band.min ? "ok" : "under-min", quality: low, size: lowSize };
}

/** The source rectangle to draw so it fills an output of outWidth × outHeight. */
export function coverCrop(
  srcWidth: number,
  srcHeight: number,
  outWidth: number,
  outHeight: number,
  framing: CropFraming,
): Rect {
  const aspect = outWidth / outHeight;
  let width = srcWidth;
  let height = srcHeight;
  if (srcWidth / srcHeight > aspect) width = srcHeight * aspect;
  else height = srcWidth / aspect;

  const zoom = Math.max(1, framing.zoom);
  width /= zoom;
  height /= zoom;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: (srcWidth - width) * clamp(framing.x),
    y: (srcHeight - height) * clamp(framing.y),
    width,
    height,
  };
}

/**
 * The paper's brightness: the 90th percentile, so a desk or shadow covering
 * most of the photo does not pass for paper.
 */
export function paperLevel(lum: Uint8Array): number {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < lum.length; i++) histogram[lum[i]]++;
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += histogram[v];
    if (seen >= lum.length * 0.9) return v;
  }
  return 255;
}

/**
 * The box around the ink on a photographed page, with a small margin, or null
 * when there is no ink. Dark areas touching the photo's edge (desk, page edge,
 * shadow) are not ink. Rows and columns need a few dark pixels to count, so
 * dust and JPEG specks do not stretch the box.
 */
export function inkBounds(lum: Uint8Array, width: number, height: number): Rect | null {
  const paper = paperLevel(lum);
  const threshold = paper - Math.max(40, paper * 0.25);

  const dark = new Uint8Array(lum.length);
  for (let i = 0; i < lum.length; i++) dark[i] = lum[i] < threshold ? 1 : 0;

  // A dark region touching the edge is desk, page edge or shadow when it runs
  // along half a side or more, or when it is a solid patch filling a corner
  // (a tilted page, an L-shaped shadow): one unbroken run per row, where
  // handwriting has paper between its strokes. Ink that reaches one edge, even bold
  // marker or a thumb print, stays: a patch on one edge cannot be told apart
  // from it, so the studio lets the user switch the trim off instead.
  const seen = new Int32Array(lum.length);
  let label = 0;
  const visit = (start: number) => {
    if (!dark[start] || seen[start]) return;
    label++;
    const pixels: number[] = [];
    const stack = [start];
    seen[start] = label;
    let runs = 0;
    let top = 0;
    let bottom = 0;
    let left = 0;
    let right = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (stack.length) {
      const i = stack.pop()!;
      pixels.push(i);
      const x = i % width;
      const y = (i - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (y === 0) top++;
      if (y === height - 1) bottom++;
      if (x === 0) left++;
      if (x === width - 1) right++;
      const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, y < height - 1 ? i + width : -1];
      for (const n of next) {
        if (n >= 0 && dark[n] && !seen[n]) {
          seen[n] = label;
          stack.push(n);
        }
      }
    }
    // Once the region is fully labelled: a run starts where the pixel to its left is not in it.
    for (const i of pixels) if (i % width === 0 || seen[i - 1] !== label) runs++;
    const hugsEdge =
      Math.max(top, bottom) >= width * 0.5 || Math.max(left, right) >= height * 0.5;
    const solid = pixels.length / ((maxX - minX + 1) * (maxY - minY + 1)) > 0.4;
    const sizeable = pixels.length > lum.length * 0.01;
    const coversCentre =
      minX <= width / 2 && maxX >= width / 2 && minY <= height / 2 && maxY >= height / 2;
    const inCorner = (top > 0 || bottom > 0) && (left > 0 || right > 0);
    const unbroken = runs <= (maxY - minY + 1) * 1.3;
    if (hugsEdge || (inCorner && solid && unbroken && sizeable && !coversCentre)) {
      for (const i of pixels) dark[i] = 0;
    }
  };
  for (let x = 0; x < width; x++) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    visit(y * width);
    visit(y * width + width - 1);
  }

  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (dark[y * width + x]) {
        rows[y]++;
        cols[x]++;
      }
    }
  }

  const minRow = Math.max(2, Math.round(width * 0.004));
  const minCol = Math.max(2, Math.round(height * 0.004));
  let top = -1;
  let bottom = -1;
  let left = -1;
  let right = -1;
  for (let y = 0; y < height; y++) {
    if (rows[y] >= minRow) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  for (let x = 0; x < width; x++) {
    if (cols[x] >= minCol) {
      if (left < 0) left = x;
      right = x;
    }
  }
  if (top < 0 || left < 0) return null;

  const boxWidth = right - left + 1;
  const boxHeight = bottom - top + 1;
  const margin = Math.max(4, Math.round(Math.max(boxWidth, boxHeight) * 0.08));
  const x = Math.max(0, left - margin);
  const y = Math.max(0, top - margin);
  return {
    x,
    y,
    width: Math.min(width, right + 1 + margin) - x,
    height: Math.min(height, bottom + 1 + margin) - y,
  };
}
