import type { Pixels } from "@/lib/compress-engine";

/**
 * Scanned text is two-tone: dark ink on pale paper. These helpers decide
 * whether an image is that, and if so turn it into 1-bit ink/paper samples
 * (1 = ink) that survive the trip through a JBIG2 encoder.
 */

const BLOCK = 32;
const TILE = 64;
/** A tile is photo-like when this share of it sits between ink and paper. */
const PHOTO_TILE_MIDTONES = 0.4;
/** Tiles with that look, as a share of the page, before the image is kept as is. */
const PHOTO_TILES_ALLOWED = 0.004;
/** Mean R-G / G-B spread above which ink or paper is a real colour. */
const COLOR_SPREAD = 14;

/** Rec. 601 luma of RGBA pixels. */
export function lumaOf(pixels: Pixels): Uint8Array {
  const count = pixels.width * pixels.height;
  const out = new Uint8Array(count);
  const d = pixels.data;
  for (let p = 0, o = 0; p < count; p++, o += 4) {
    out[p] = (d[o] * 77 + d[o + 1] * 150 + d[o + 2] * 29) >> 8;
  }
  return out;
}

/** True when ink and paper are tinted, so dropping colour would lose information. */
export function isColorful(pixels: Pixels): boolean {
  const count = pixels.width * pixels.height;
  const step = Math.max(1, Math.floor(count / 20000));
  const d = pixels.data;
  let spread = 0;
  let n = 0;
  for (let p = 0; p < count; p += step) {
    const o = p * 4;
    spread += Math.abs(d[o] - d[o + 1]) + Math.abs(d[o + 1] - d[o + 2]);
    n++;
  }
  return spread / Math.max(n, 1) > COLOR_SPREAD;
}

/** Otsu's threshold over a 256-bin histogram. */
export function otsu(hist: ArrayLike<number>): number {
  let total = 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    sum += i * hist[i];
  }
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

export type Binarized = {
  /** 1 for ink, 0 for paper; width * height samples. */
  ink: Uint8Array;
  /** Share of pixels that sit between ink and paper tones, 0..1. */
  midtones: number;
  /** True when no region looks like a photograph. */
  bilevel: boolean;
};

/**
 * Splits luma into ink and paper. The cut follows the paper's own brightness
 * block by block, so a shaded corner or a scanner edge doesn't turn into ink.
 * Regions full of midtones (photos, shaded drawings) mark the image as not
 * bilevel; callers should leave those alone.
 */
export function binarize(luma: Uint8Array, width: number, height: number): Binarized {
  const hist = new Float64Array(256);
  const step = Math.max(1, Math.floor(luma.length / 400000));
  for (let p = 0; p < luma.length; p += step) hist[luma[p]]++;
  const t = otsu(hist);
  // Class means give the paper level and the ink-to-paper ratio.
  let lo = 0;
  let loN = 0;
  let hi = 0;
  let hiN = 0;
  for (let i = 0; i < 256; i++) {
    if (i <= t) {
      lo += i * hist[i];
      loN += hist[i];
    } else {
      hi += i * hist[i];
      hiN += hist[i];
    }
  }
  const ink = loN ? lo / loN : 0;
  const paper = hiN ? hi / hiN : 255;
  const ratio = paper > 0 ? Math.min(0.9, Math.max(0.25, t / paper)) : 0.5;

  // Paper level per block: a high percentile ignores ink, then a max filter
  // lets blocks that are mostly ink borrow from their neighbours.
  const bw = Math.ceil(width / BLOCK);
  const bh = Math.ceil(height / BLOCK);
  const level = new Float32Array(bw * bh);
  const local = new Uint32Array(256);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      local.fill(0);
      const y1 = Math.min(height, (by + 1) * BLOCK);
      const x1 = Math.min(width, (bx + 1) * BLOCK);
      let n = 0;
      for (let y = by * BLOCK; y < y1; y++) {
        for (let x = bx * BLOCK; x < x1; x++) {
          local[luma[y * width + x]]++;
          n++;
        }
      }
      let seen = 0;
      let v = 255;
      const cut = n * 0.15;
      for (v = 255; v > 0; v--) {
        seen += local[v];
        if (seen >= cut) break;
      }
      level[by * bw + bx] = Math.max(v, t + 1);
    }
  }
  const smooth = new Float32Array(level.length);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let m = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = by + dy;
          const x = bx + dx;
          if (y >= 0 && y < bh && x >= 0 && x < bw) m = Math.max(m, level[y * bw + x]);
        }
      }
      smooth[by * bw + bx] = m;
    }
  }

  const out = new Uint8Array(width * height);
  const tileW = Math.ceil(width / TILE);
  const mid = new Uint32Array(tileW * Math.ceil(height / TILE));
  const cells = new Uint32Array(mid.length);
  let midCount = 0;
  for (let y = 0; y < height; y++) {
    // Bilinear paper level along the row between block centres.
    const fy = Math.min(bh - 1, Math.max(0, (y + 0.5) / BLOCK - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(bh - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x + 0.5) / BLOCK - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(bw - 1, x0 + 1);
      const wx = fx - x0;
      const top = smooth[y0 * bw + x0] * (1 - wx) + smooth[y0 * bw + x1] * wx;
      const bottom = smooth[y1 * bw + x0] * (1 - wx) + smooth[y1 * bw + x1] * wx;
      const bg = top * (1 - wy) + bottom * wy;
      const cut = bg * ratio;
      const v = luma[y * width + x];
      out[y * width + x] = v < cut ? 1 : 0;
      const tile = ((y / TILE) | 0) * tileW + ((x / TILE) | 0);
      cells[tile]++;
      // Midtones are measured against the paper right here, not the page average.
      if (v > ink + (bg - ink) * 0.2 && v < bg - (bg - ink) * 0.2) {
        mid[tile]++;
        midCount++;
      }
    }
  }
  let photoTiles = 0;
  for (let i = 0; i < mid.length; i++) {
    if (cells[i] >= TILE * TILE * 0.25 && mid[i] / cells[i] > PHOTO_TILE_MIDTONES) photoTiles++;
  }
  return {
    ink: out,
    midtones: midCount / luma.length,
    bilevel: photoTiles / mid.length <= PHOTO_TILES_ALLOWED && paper - ink > 60,
  };
}

/** Area-average downscale of luma; the box filter keeps thin strokes dark enough to survive thresholding. */
export function shrinkLuma(
  luma: Uint8Array,
  width: number,
  height: number,
  toWidth: number,
  toHeight: number,
): Uint8Array {
  if (toWidth === width && toHeight === height) return luma;
  const sx = width / toWidth;
  const sy = height / toHeight;
  // Horizontal pass into floats, then vertical.
  const mid = new Float32Array(toWidth * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < toWidth; x++) {
      const a = x * sx;
      const b = a + sx;
      const i0 = Math.floor(a);
      const i1 = Math.min(width - 1, Math.ceil(b) - 1);
      let acc = 0;
      for (let i = i0; i <= i1; i++) {
        acc += luma[row + i] * (Math.min(i + 1, b) - Math.max(i, a));
      }
      mid[y * toWidth + x] = acc / sx;
    }
  }
  const out = new Uint8Array(toWidth * toHeight);
  for (let y = 0; y < toHeight; y++) {
    const a = y * sy;
    const b = a + sy;
    const j0 = Math.floor(a);
    const j1 = Math.min(height - 1, Math.ceil(b) - 1);
    for (let x = 0; x < toWidth; x++) {
      let acc = 0;
      for (let j = j0; j <= j1; j++) {
        acc += mid[j * toWidth + x] * (Math.min(j + 1, b) - Math.max(j, a));
      }
      out[y * toWidth + x] = Math.round(acc / sy);
    }
  }
  return out;
}

/** Packs ink samples (1 = ink) the way a 1-bit DeviceGray image stores them: 0 is black. */
export function packGray1(ink: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = (width + 7) >> 3;
  const out = new Uint8Array(rowBytes * height).fill(0xff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (ink[y * width + x]) out[y * rowBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
    }
  }
  return out;
}

/** Reverse of packGray1. */
export function unpackGray1(packed: Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = (width + 7) >> 3;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      out[y * width + x] = packed[y * rowBytes + (x >> 3)] & (0x80 >> (x & 7)) ? 0 : 1;
    }
  }
  return out;
}
