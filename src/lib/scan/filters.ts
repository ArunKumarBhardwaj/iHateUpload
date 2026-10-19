import { binarize } from "@/lib/bilevel";

import type { RGBAImage, ScanFilter } from "./types";

export type Filtered = {
  rgba: RGBAImage;
  /** 1 = ink. Only for the B&W filter. */
  ink?: Uint8Array;
};

const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function lumaOf(img: RGBAImage) {
  const n = img.width * img.height;
  const out = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = (img.data[p] * 77 + img.data[p + 1] * 150 + img.data[p + 2] * 29) >> 8;
  }
  return out;
}

/**
 * White balance: finds the paper tone block by block (a high percentile, so
 * ink doesn't count) and divides it out, so shadows and tinted light vanish.
 */
export function flattenIllumination(img: RGBAImage): RGBAImage {
  const { width: w, height: h } = img;
  const block = Math.max(8, Math.round(Math.min(w, h) / 36));
  const bx = Math.ceil(w / block);
  const by = Math.ceil(h / block);
  const bg = new Float32Array(bx * by * 3);
  const hist = new Uint32Array(256);
  for (let c = 0; c < 3; c++) {
    for (let j = 0; j < by; j++) {
      for (let i = 0; i < bx; i++) {
        hist.fill(0);
        let n = 0;
        const y1 = Math.min(h, (j + 1) * block);
        const x1 = Math.min(w, (i + 1) * block);
        for (let y = j * block; y < y1; y++) {
          for (let x = i * block; x < x1; x++) {
            hist[img.data[(y * w + x) * 4 + c]]++;
            n++;
          }
        }
        const target = n * 0.9;
        let acc = 0;
        let v = 255;
        for (let k = 0; k < 256; k++) {
          acc += hist[k];
          if (acc >= target) {
            v = k;
            break;
          }
        }
        bg[(j * bx + i) * 3 + c] = v;
      }
    }
  }
  // Smooth the block map once so seams between blocks disappear.
  const sm = new Float32Array(bg.length);
  for (let j = 0; j < by; j++) {
    for (let i = 0; i < bx; i++) {
      for (let c = 0; c < 3; c++) {
        let s = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const jj = j + dj;
            const ii = i + di;
            if (jj < 0 || ii < 0 || jj >= by || ii >= bx) continue;
            s += bg[(jj * bx + ii) * 3 + c];
            n++;
          }
        }
        sm[(j * bx + i) * 3 + c] = s / n;
      }
    }
  }
  const out = new Uint8ClampedArray(img.data.length);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(by - 1, Math.max(0, (y + 0.5) / block - 0.5));
    const j0 = Math.floor(fy);
    const j1 = Math.min(by - 1, j0 + 1);
    const ty = fy - j0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(bx - 1, Math.max(0, (x + 0.5) / block - 0.5));
      const i0 = Math.floor(fx);
      const i1 = Math.min(bx - 1, i0 + 1);
      const tx = fx - i0;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const a = sm[(j0 * bx + i0) * 3 + c] * (1 - tx) + sm[(j0 * bx + i1) * 3 + c] * tx;
        const b = sm[(j1 * bx + i0) * 3 + c] * (1 - tx) + sm[(j1 * bx + i1) * 3 + c] * tx;
        const paper = Math.max(40, a * (1 - ty) + b * ty);
        out[o + c] = clamp((img.data[o + c] * 255) / paper);
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Stretches tones so the darkest 0.5% go black and the brightest 0.5% white. */
function autoLevels(img: RGBAImage, gamma = 1): RGBAImage {
  const luma = lumaOf(img);
  const hist = new Uint32Array(256);
  for (let i = 0; i < luma.length; i++) hist[luma[i]]++;
  const cut = luma.length * 0.005;
  let lo = 0;
  let hi = 255;
  for (let a = 0; lo < 255; lo++) {
    a += hist[lo];
    if (a > cut) break;
  }
  for (let a = 0; hi > 0; hi--) {
    a += hist[hi];
    if (a > cut) break;
  }
  if (hi - lo < 24) return img;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    lut[v] = 255 * Math.pow(clamp(((v - lo) * 255) / (hi - lo)) / 255, gamma);
  }
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    out[i] = lut[img.data[i]];
    out[i + 1] = lut[img.data[i + 1]];
    out[i + 2] = lut[img.data[i + 2]];
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

/** Brightness and contrast, each -100..100, applied per channel. */
export function adjustTone(img: RGBAImage, brightness: number, contrast: number): RGBAImage {
  if (!brightness && !contrast) return img;
  const c = contrast * 2.55;
  const f = (259 * (c + 255)) / (255 * (259 - c));
  const add = brightness * 1.6;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = clamp(f * (v - 128) + 128 + add);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    out[i] = lut[img.data[i]];
    out[i + 1] = lut[img.data[i + 1]];
    out[i + 2] = lut[img.data[i + 2]];
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

function toGray(img: RGBAImage): RGBAImage {
  const luma = lumaOf(img);
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0, p = 0; i < luma.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = luma[i];
    out[p + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

function saturate(img: RGBAImage, amount: number): RGBAImage {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const y = (img.data[i] * 77 + img.data[i + 1] * 150 + img.data[i + 2] * 29) >> 8;
    out[i] = y + (img.data[i] - y) * amount;
    out[i + 1] = y + (img.data[i + 1] - y) * amount;
    out[i + 2] = y + (img.data[i + 2] - y) * amount;
    out[i + 3] = 255;
  }
  return { data: out, width: img.width, height: img.height };
}

export function applyFilter(
  img: RGBAImage,
  filter: ScanFilter,
  brightness = 0,
  contrast = 0,
): Filtered {
  switch (filter) {
    case "original":
      return { rgba: adjustTone(img, brightness, contrast) };
    case "photo":
      return { rgba: adjustTone(saturate(autoLevels(img), 1.12), brightness, contrast) };
    case "gray":
      return { rgba: adjustTone(toGray(autoLevels(img)), brightness, contrast) };
    case "document": {
      const flat = autoLevels(flattenIllumination(img), 1.35);
      return { rgba: adjustTone(flat, brightness, contrast) };
    }
    case "bw": {
      const flat = adjustTone(toGray(flattenIllumination(img)), brightness, contrast);
      const { ink } = binarize(lumaOf(flat), flat.width, flat.height);
      const out = new Uint8ClampedArray(flat.data.length);
      for (let i = 0, p = 0; i < ink.length; i++, p += 4) {
        out[p] = out[p + 1] = out[p + 2] = ink[i] ? 0 : 255;
        out[p + 3] = 255;
      }
      return { rgba: { data: out, width: flat.width, height: flat.height }, ink };
    }
  }
}
