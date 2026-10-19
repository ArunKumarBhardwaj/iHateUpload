function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = Number.parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * Turns a photo of a signature into ink on a clear background, in place.
 * Pixels lighter than `threshold` (0-255 brightness) become transparent,
 * darker ones fade in, and `color` repaints the ink when given.
 */
export function removeBackground(
  rgba: Uint8ClampedArray | Uint8Array,
  { threshold, color }: { threshold: number; color?: string },
) {
  const ink = color ? parseHex(color) : null;
  const limit = Math.max(1, Math.min(255, threshold));
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (lum >= limit) {
      rgba[i + 3] = 0;
      continue;
    }
    // Darker than a third of the limit is solid; between, it fades.
    const solid = limit / 3;
    const alpha = lum <= solid ? 1 : 1 - (lum - solid) / (limit - solid);
    rgba[i + 3] = Math.round(alpha * (rgba[i + 3] / 255) * 255);
    if (ink) {
      rgba[i] = ink[0];
      rgba[i + 1] = ink[1];
      rgba[i + 2] = ink[2];
    }
  }
}

/** Smallest box (in pixels) that holds every non-clear pixel, or null. */
export function inkBounds(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] > 12) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
