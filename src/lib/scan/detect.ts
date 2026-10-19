import { otsu } from "@/lib/bilevel";

import { downscale, orderQuad, quadArea, scaleQuad } from "./geometry";
import type { Pt, Quad, RGBAImage } from "./types";

const WORK_SIDE = 400;

export type Detection = {
  quad: Quad;
  /** False when nothing page-shaped was found; the quad is then the whole frame. */
  found: boolean;
};

function grayOf(img: RGBAImage) {
  const g = new Float32Array(img.width * img.height);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (img.data[p] * 77 + img.data[p + 1] * 150 + img.data[p + 2] * 29) / 256;
  }
  return g;
}

function boxBlur(src: Float32Array, w: number, h: number) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = src[y * w + Math.max(0, x - 1)];
      const b = src[y * w + x];
      const c = src[y * w + Math.min(w - 1, x + 1)];
      tmp[y * w + x] = (a + b + c) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = tmp[Math.max(0, y - 1) * w + x];
      const b = tmp[y * w + x];
      const c = tmp[Math.min(h - 1, y + 1) * w + x];
      out[y * w + x] = (a + b + c) / 3;
    }
  }
  return out;
}

function sobel(g: Float32Array, w: number, h: number) {
  const m = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        g[i - w + 1] + 2 * g[i + 1] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - 1] - g[i + w - 1];
      const gy =
        g[i + w - 1] + 2 * g[i + w] + g[i + w + 1] - g[i - w - 1] - 2 * g[i - w] - g[i - w + 1];
      m[i] = Math.hypot(gx, gy) / 4;
    }
  }
  return m;
}

function morph(mask: Uint8Array, w: number, h: number, grow: boolean) {
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let any = 0;
      let all = 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const v = xx < 0 || yy < 0 || xx >= w || yy >= h ? (grow ? 0 : 1) : mask[yy * w + xx];
          if (v) any = 1;
          else all = 0;
        }
      }
      out[y * w + x] = grow ? any : all;
    }
  }
  return out;
}

/** Marks everything reachable from the frame edge without crossing `wall`. */
function floodFromBorder(wall: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = y * w + x;
    if (!wall[i] && !seen[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return seen;
}

/** Keeps only the biggest 4-connected blob. Returns its pixel count. */
function largestBlob(mask: Uint8Array, w: number, h: number): { mask: Uint8Array; size: number } {
  const label = new Int32Array(w * h);
  let best = 0;
  let bestSize = 0;
  let next = 0;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || label[s]) continue;
    next++;
    let size = 0;
    stack.push(s);
    label[s] = next;
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      const tryPush = (j: number) => {
        if (mask[j] && !label[j]) {
          label[j] = next;
          stack.push(j);
        }
      };
      if (x > 0) tryPush(i - 1);
      if (x < w - 1) tryPush(i + 1);
      if (y > 0) tryPush(i - w);
      if (y < h - 1) tryPush(i + w);
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) if (label[i] === best) out[i] = 1;
  return { mask: out, size: bestSize };
}

function convexHull(points: Pt[]): Pt[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Thins a closed polygon until it has at most `max` vertices, dropping the least useful first. */
function simplifyHull(hull: Pt[], max: number): Pt[] {
  const pts = [...hull];
  while (pts.length > max) {
    let bestI = 0;
    let bestArea = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
      if (area < bestArea) {
        bestArea = area;
        bestI = i;
      }
    }
    pts.splice(bestI, 1);
  }
  return pts;
}

function polyArea(p: Pt[]) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const n = p[(i + 1) % p.length];
    a += p[i].x * n.y - n.x * p[i].y;
  }
  return Math.abs(a) / 2;
}

/** The four hull corners that enclose the most area. */
function bestQuad(hull: Pt[]): Quad | null {
  const pts = simplifyHull(hull, 22);
  const n = pts.length;
  if (n < 4) return null;
  let best = 0;
  let pick: Pt[] | null = null;
  for (let a = 0; a < n - 3; a++) {
    for (let b = a + 1; b < n - 2; b++) {
      for (let c = b + 1; c < n - 1; c++) {
        for (let d = c + 1; d < n; d++) {
          const q = [pts[a], pts[b], pts[c], pts[d]];
          const area = polyArea(q);
          if (area > best) {
            best = area;
            pick = q;
          }
        }
      }
    }
  }
  return pick ? orderQuad(pick) : null;
}

function quadFromMask(mask: Uint8Array, w: number, h: number): Quad | null {
  const border: Pt[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const edge =
        x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
        !mask[y * w + x - 1] || !mask[y * w + x + 1] || !mask[(y - 1) * w + x] || !mask[(y + 1) * w + x];
      if (edge) border.push({ x: x + 0.5, y: y + 0.5 });
    }
  }
  if (border.length < 8) return null;
  const hull = convexHull(border);
  const quad = bestQuad(hull);
  if (!quad) return null;
  // A page is a convex four-sided shape: the quad has to account for the whole hull.
  if (quadArea(quad) < polyArea(hull) * 0.9) return null;
  return quad;
}

function acceptable(quad: Quad | null, w: number, h: number): quad is Quad {
  if (!quad) return false;
  const share = quadArea(quad) / (w * h);
  if (share < 0.12 || share > 0.97) return false;
  // Corners shouldn't fold the shape: every interior angle stays between 40 and 140 degrees.
  for (let i = 0; i < 4; i++) {
    const a = quad[(i + 3) % 4];
    const b = quad[i];
    const c = quad[(i + 1) % 4];
    const v1 = { x: a.x - b.x, y: a.y - b.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1);
    if (cos > 0.77 || cos < -0.77) return false;
  }
  return true;
}

function fromEdges(g: Float32Array, w: number, h: number, scale: number): Quad | null {
  const mag = sobel(g, w, h);
  let mean = 0;
  for (const v of mag) mean += v;
  mean /= mag.length;
  let varSum = 0;
  for (const v of mag) varSum += (v - mean) ** 2;
  const strong = mean + 1.5 * Math.sqrt(varSum / mag.length);
  let best: Quad | null = null;
  let bestArea = 0;
  for (const factor of [1, 0.6, 0.35, 0.2]) {
    const t = Math.max(5, strong * factor);
    let wall = new Uint8Array(w * h);
    for (let i = 0; i < wall.length; i++) wall[i] = mag[i] > t ? 1 : 0;
    const thin = morph(wall, w, h, true);
    wall = morph(thin, w, h, true);
    const bg = floodFromBorder(wall, w, h);
    let page = new Uint8Array(w * h);
    for (let i = 0; i < page.length; i++) page[i] = bg[i] ? 0 : 1;
    page = morph(morph(page, w, h, false), w, h, false);
    const { mask } = largestBlob(page, w, h);
    const quad = quadFromMask(mask, w, h);
    if (!acceptable(quad, w, h) || edgeSupport(quad, thin, w, h) < 0.8) continue;
    const area = quadArea(quad);
    if (area > bestArea) {
      best = quad;
      bestArea = area;
    }
  }
  // The edge walls were thickened to close gaps, so the outline sits outside the true edge.
  return best ? scaleQuad(insetQuad(best, EDGE_INSET), scale, scale) : null;
}

/** Work-size pixels the outline is pulled in after thickened edges were traced. */
const EDGE_INSET = 1.5;

/** Moves every side of a convex quad `d` pixels toward its middle. */
function insetQuad(q: Quad, d: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4;
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4;
  const lines = q.map((a, i) => {
    const b = q[(i + 1) % 4];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    let nx = -(b.y - a.y) / len;
    let ny = (b.x - a.x) / len;
    if (nx * (cx - a.x) + ny * (cy - a.y) < 0) {
      nx = -nx;
      ny = -ny;
    }
    return { p: { x: a.x + nx * d, y: a.y + ny * d }, v: { x: b.x - a.x, y: b.y - a.y } };
  });
  const corner = (l1: (typeof lines)[number], l2: (typeof lines)[number], fallback: Pt) => {
    const det = l1.v.x * l2.v.y - l1.v.y * l2.v.x;
    if (Math.abs(det) < 1e-9) return fallback;
    const t = ((l2.p.x - l1.p.x) * l2.v.y - (l2.p.y - l1.p.y) * l2.v.x) / det;
    return { x: l1.p.x + l1.v.x * t, y: l1.p.y + l1.v.y * t };
  };
  return [corner(lines[3], lines[0], q[0]), corner(lines[0], lines[1], q[1]), corner(lines[1], lines[2], q[2]), corner(lines[2], lines[3], q[3])];
}

/** Share of the quad's outline that sits on a detected edge. */
function edgeSupport(q: Quad, wall: Uint8Array, w: number, h: number) {
  let hit = 0;
  let total = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    for (let k = 0; k < 60; k++) {
      const x = Math.round(a.x + ((b.x - a.x) * k) / 60);
      const y = Math.round(a.y + ((b.y - a.y) * k) / 60);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      total++;
      // The outline of the frame itself counts: a sheet running off the photo has no edge there.
      if (wall[y * w + x] || x < 3 || y < 3 || x > w - 4 || y > h - 4) hit++;
    }
  }
  return total ? hit / total : 0;
}

function fromBrightness(g: Float32Array, w: number, h: number, scale: number): Quad | null {
  const hist = new Float64Array(256);
  for (const v of g) hist[Math.max(0, Math.min(255, Math.round(v)))]++;
  const t = otsu(hist);
  let bright = new Uint8Array(w * h);
  for (let i = 0; i < bright.length; i++) bright[i] = g[i] > t ? 1 : 0;
  // Dark print inside the sheet is a hole: fill whatever the frame edge cannot reach.
  const outside = floodFromBorder(bright, w, h);
  for (let i = 0; i < bright.length; i++) if (!outside[i]) bright[i] = 1;
  bright = morph(morph(bright, w, h, false), w, h, true);
  const { mask } = largestBlob(bright, w, h);
  const quad = quadFromMask(mask, w, h);
  return acceptable(quad, w, h) ? scaleQuad(quad, scale, scale) : null;
}

/** Looks for a page-shaped region: edges first, then a bright-region fallback. */
export function detectDocument(img: RGBAImage): Detection {
  const small = downscale(img, WORK_SIDE);
  const scale = img.width / small.width;
  const g = boxBlur(boxBlur(grayOf(small), small.width, small.height), small.width, small.height);
  const quad =
    fromEdges(g, small.width, small.height, scale) ??
    fromBrightness(g, small.width, small.height, scale);
  if (quad) return { quad, found: true };
  return {
    quad: [
      { x: 0, y: 0 },
      { x: img.width, y: 0 },
      { x: img.width, y: img.height },
      { x: 0, y: img.height },
    ],
    found: false,
  };
}
