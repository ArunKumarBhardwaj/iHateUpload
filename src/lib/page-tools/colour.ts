import type { InvertMode } from "./types";

/** Soft floor and ceiling for dark mode, so pages are not pure black on pure white. */
export const DARK_FLOOR = [28, 30, 34] as const;
export const DARK_CEIL = [232, 232, 232] as const;
/** Tints for sepia: hue source and the paper tone whites are multiplied by. */
export const SEPIA_INK = [112, 66, 20] as const;
export const SEPIA_PAPER = [244, 236, 216] as const;

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Colour of one pixel after the mode; mirrors the overlays the vector engine draws. */
export function mapPixel(
  mode: InvertMode,
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  switch (mode) {
    case "invert":
      return [255 - r, 255 - g, 255 - b];
    case "grayscale": {
      const y = clamp(0.2126 * r + 0.7152 * g + 0.0722 * b);
      return [y, y, y];
    }
    case "sepia": {
      const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      return [
        clamp(y * SEPIA_PAPER[0] * 1.0 + 0),
        clamp(y * SEPIA_PAPER[1] * 0.93),
        clamp(y * SEPIA_PAPER[2] * 0.72),
      ];
    }
    case "dark": {
      // Invert, then rotate hue back by 180 degrees so colours keep their hue.
      const ir = 255 - r;
      const ig = 255 - g;
      const ib = 255 - b;
      // CSS hue-rotate(180deg) matrix.
      const nr = -0.574 * ir + 1.43 * ig + 0.144 * ib;
      const ng = 0.426 * ir + 0.43 * ig + 0.144 * ib;
      const nb = 0.426 * ir + 1.43 * ig - 0.856 * ib;
      const soft = (v: number, k: number) =>
        clamp(DARK_FLOOR[k] + (clamp(v) / 255) * (DARK_CEIL[k] - DARK_FLOOR[k]));
      return [soft(nr, 0), soft(ng, 1), soft(nb, 2)];
    }
  }
}
