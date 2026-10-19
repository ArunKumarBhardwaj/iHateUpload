import type { Pt, Quad, RGBAImage } from "./types";

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Sorts four points into top-left, top-right, bottom-right, bottom-left. */
export function orderQuad(pts: Pt[]): Quad {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const byAngle = [...pts].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // Angles ascend clockwise on screen (y down). Start at the point nearest the top-left.
  let start = 0;
  let best = Infinity;
  byAngle.forEach((p, i) => {
    const s = p.x + p.y;
    if (s < best) {
      best = s;
      start = i;
    }
  });
  return [0, 1, 2, 3].map((i) => byAngle[(start + i) % 4]) as Quad;
}

/** Width and height a flat sheet would have: the mean of opposite edges. */
export function quadSize(q: Quad) {
  return {
    width: (dist(q[0], q[1]) + dist(q[3], q[2])) / 2,
    height: (dist(q[0], q[3]) + dist(q[1], q[2])) / 2,
  };
}

export function quadArea(q: Quad) {
  let a = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i];
    const n = q[(i + 1) % 4];
    a += p.x * n.y - n.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function scaleQuad(q: Quad, sx: number, sy: number): Quad {
  return q.map((p) => ({ x: p.x * sx, y: p.y * sy })) as Quad;
}

/** Solves for the 3x3 matrix (row-major, h22 = 1) that sends src[i] to dst[i]. */
export function homography(src: Quad, dst: Quad): number[] {
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    if (Math.abs(d) < 1e-12) throw new Error("The corners are not a usable shape.");
    for (let k = c; k < 9; k++) a[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f === 0) continue;
      for (let k = c; k < 9; k++) a[r][k] -= f * a[c][k];
    }
  }
  return [...a.map((row) => row[8]), 1];
}

/**
 * Flattens the quad of `src` into a width x height rectangle with bilinear
 * sampling. Pixels that fall outside the photo become white.
 */
export function warpPerspective(
  src: RGBAImage,
  quad: Quad,
  width: number,
  height: number,
): RGBAImage {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
  // Map output pixels back into the photo.
  const h = homography(rect, quad);
  const out = new Uint8ClampedArray(width * height * 4);
  const sw = src.width;
  const sh = src.height;
  const sd = src.data;
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      const w = h[6] * px + h[7] * py + 1;
      const sx = (h[0] * px + h[1] * py + h[2]) / w - 0.5;
      const sy = (h[3] * px + h[4] * py + h[5]) / w - 0.5;
      const o = (y * width + x) * 4;
      if (sx < -0.5 || sy < -0.5 || sx > sw - 0.5 || sy > sh - 0.5) {
        out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 255;
        continue;
      }
      const x0 = Math.max(0, Math.min(sw - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(sh - 1, Math.floor(sy)));
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx;
        const bot = sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { data: out, width, height };
}

export function rotateImage(img: RGBAImage, degrees: 0 | 90 | 180 | 270): RGBAImage {
  if (degrees === 0) return img;
  const { width: w, height: h, data } = img;
  const swap = degrees !== 180;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      if (degrees === 90) {
        nx = h - 1 - y;
        ny = x;
      } else if (degrees === 180) {
        nx = w - 1 - x;
        ny = h - 1 - y;
      } else {
        nx = y;
        ny = w - 1 - x;
      }
      const s = (y * w + x) * 4;
      const d = (ny * ow + nx) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { data: out, width: ow, height: oh };
}

/** Box-average downscale so the longest side is at most `maxSide`. */
export function downscale(img: RGBAImage, maxSide: number): RGBAImage {
  const k = Math.max(img.width, img.height) / maxSide;
  if (k <= 1) return img;
  const w = Math.max(1, Math.round(img.width / k));
  const h = Math.max(1, Math.round(img.height / k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const ya = Math.floor((y * img.height) / h);
    const yb = Math.max(ya + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const xa = Math.floor((x * img.width) / w);
      const xb = Math.max(xa + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = ya; yy < yb; yy++) {
        for (let xx = xa; xx < xb; xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Width over height of the flat sheet behind a photographed quad. A tilted
 * sheet shrinks toward the far edge, so averaging edge lengths misjudges it;
 * this solves for the camera's focal length (square pixels, centred lens) as
 * in Zhang and He's whiteboard-scanning method. Falls back to edge lengths
 * when the sheet is nearly square-on and the maths degenerates.
 */
export function documentAspect(q: Quad, imgW: number, imgH: number): number {
  const plain = quadSize(q);
  const fallback = plain.width / Math.max(plain.height, 1e-9);
  const u0 = imgW / 2;
  const v0 = imgH / 2;
  const m1: V3 = [q[0].x, q[0].y, 1];
  const m2: V3 = [q[1].x, q[1].y, 1];
  const m3: V3 = [q[3].x, q[3].y, 1];
  const m4: V3 = [q[2].x, q[2].y, 1];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  if (!Number.isFinite(k2) || !Number.isFinite(k3)) return fallback;
  const n2: V3 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 - 1];
  const n3: V3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 - 1];
  if (Math.abs(n2[2] * n3[2]) < 1e-4) return fallback;
  const f2 =
    -(
      n2[0] * n3[0] - (n2[0] * n3[2] + n2[2] * n3[0]) * u0 + n2[2] * n3[2] * u0 * u0 +
      n2[1] * n3[1] - (n2[1] * n3[2] + n2[2] * n3[1]) * v0 + n2[2] * n3[2] * v0 * v0
    ) / (n2[2] * n3[2]);
  if (!(f2 > 0) || !Number.isFinite(f2)) return fallback;
  const f = Math.sqrt(f2);
  const norm = (n: V3) => {
    const x = (n[0] - u0 * n[2]) / f;
    const y = (n[1] - v0 * n[2]) / f;
    return Math.hypot(x, y, n[2]);
  };
  const ratio = norm(n2) / norm(n3);
  if (!(ratio > 0.2 && ratio < 5)) return fallback;
  return ratio;
}
