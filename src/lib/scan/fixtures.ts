import { homography } from "./geometry";
import type { Quad, RGBAImage } from "./types";

/** Tiny deterministic random source so fixtures never change between runs. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A white sheet with grey "text" bars, a heading and a dark logo block. */
export function makeSheet(width: number, height: number): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const rect = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = Math.max(0, y0 | 0); y < Math.min(height, y1 | 0); y++) {
      for (let x = Math.max(0, x0 | 0); x < Math.min(width, x1 | 0); x++) {
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
      }
    }
  };
  const margin = width * 0.1;
  rect(margin, height * 0.06, width * 0.6, height * 0.1, 25);
  rect(width * 0.75, height * 0.04, width * 0.9, height * 0.11, 60);
  const rand = rng(7);
  for (let y = height * 0.16; y < height * 0.92; y += height * 0.032) {
    const line = width * (0.55 + rand() * 0.35);
    rect(margin, y, margin + line * 0.8, y + height * 0.014, 40);
  }
  return { data, width, height };
}

export type SceneOptions = {
  width: number;
  height: number;
  background?: "desk" | "dark" | "white";
  noise?: number;
  /** Brightness falloff across the sheet, 0 = none. */
  shade?: number;
};

/** Photographs `sheet` as if it lay inside `quad` (scene pixels) on a background. */
export function photographSheet(sheet: RGBAImage, quad: Quad, opts: SceneOptions): RGBAImage {
  const { width, height } = opts;
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: sheet.width, y: 0 },
    { x: sheet.width, y: sheet.height },
    { x: 0, y: sheet.height },
  ];
  const h = homography(quad, rect);
  const data = new Uint8ClampedArray(width * height * 4);
  const rand = rng(11);
  const noise = opts.noise ?? 0;
  const shade = opts.shade ?? 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const w = h[6] * x + h[7] * y + 1;
      const u = (h[0] * x + h[1] * y + h[2]) / w;
      const v = (h[3] * x + h[4] * y + h[5]) / w;
      let r: number, g: number, b: number;
      if (u >= 0 && v >= 0 && u < sheet.width - 1 && v < sheet.height - 1) {
        const i = ((v | 0) * sheet.width + (u | 0)) * 4;
        r = sheet.data[i];
        g = sheet.data[i + 1];
        b = sheet.data[i + 2];
        const f = 1 - shade * (x / width);
        r *= f; g *= f; b *= f;
      } else if (opts.background === "dark") {
        r = 40; g = 44; b = 52;
      } else if (opts.background === "white") {
        r = 180; g = 180; b = 176;
      } else {
        // Wooden desk: warm brown with grain stripes.
        const grain = 18 * Math.sin(y * 0.35 + Math.sin(x * 0.04) * 3);
        r = 150 + grain; g = 105 + grain; b = 62 + grain * 0.6;
      }
      const n = noise ? (rand() - 0.5) * noise : 0;
      data[o] = r + n;
      data[o + 1] = g + n;
      data[o + 2] = b + n;
      data[o + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Where the corners of a w x h sheet land in a pinhole camera photo (lens centred). */
export function cameraQuad(
  w: number,
  h: number,
  o: { yaw: number; pitch: number; roll?: number; dist: number; focal: number; width: number; height: number },
): Quad {
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ];
  const roll = o.roll ?? 0;
  return pts.map(([x0, y0]) => {
    let x = x0 * Math.cos(roll) - y0 * Math.sin(roll);
    let y = x0 * Math.sin(roll) + y0 * Math.cos(roll);
    let z = 0;
    // yaw about the vertical axis
    const x1 = x * Math.cos(o.yaw) + z * Math.sin(o.yaw);
    z = -x * Math.sin(o.yaw) + z * Math.cos(o.yaw);
    x = x1;
    // pitch about the horizontal axis
    const y1 = y * Math.cos(o.pitch) - z * Math.sin(o.pitch);
    z = y * Math.sin(o.pitch) + z * Math.cos(o.pitch);
    y = y1;
    z += o.dist;
    return { x: (o.focal * x) / z + o.width / 2, y: (o.focal * y) / z + o.height / 2 };
  }) as Quad;
}
