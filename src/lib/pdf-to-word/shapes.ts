import type { Decorated } from "./decorations";
import type { Bullet, PathSeg, PathShape, Rule } from "./lines";
import type { Shape } from "./model";

/** Past this many paths on a page the drawing is probably outlined text or a map; keeping it would swamp Word. */
export const MAX_SHAPES = 300;

type Box = { x0: number; y0: number; x1: number; y1: number };

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Page-sized fills lighter than this read as paper colour, not a background worth keeping. */
const PAPER_LUMINANCE = 0.8;

/** Relative luminance (0 black, 1 white) of a hex colour without a hash. */
function luminance(hex: string): number {
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function subpaths(segs: PathSeg[]): PathSeg[][] {
  const out: PathSeg[][] = [];
  for (const seg of segs) {
    if (seg.op === "M" || !out.length) out.push([]);
    out[out.length - 1].push(seg);
  }
  return out;
}

function boxOf(segs: PathSeg[]): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const seg of segs) {
    for (let i = 0; i + 1 < seg.pts.length; i += 2) {
      xs.push(seg.pts[i]);
      ys.push(seg.pts[i + 1]);
    }
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

const endOf = (seg: PathSeg): [number, number] => [seg.pts[seg.pts.length - 2], seg.pts[seg.pts.length - 1]];

/** The corners when a subpath is an axis-aligned rectangle, however the page wrote it. */
function isRect(sub: PathSeg[], box: Box): boolean {
  const drawn = sub.filter((s) => s.op !== "Z");
  if (drawn.some((s) => s.op === "C")) return false;
  const pts = drawn.map(endOf);
  if (pts.length === 5 && near(pts[0][0], pts[4][0], 0.6) && near(pts[0][1], pts[4][1], 0.6)) pts.pop();
  if (pts.length !== 4) return false;
  const closed = sub.some((s) => s.op === "Z") || drawn.length === 5;
  if (!closed) return false;
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    if (!near(a[0], b[0], 0.6) && !near(a[1], b[1], 0.6)) return false;
  }
  return pts.every((p) => (near(p[0], box.x0, 0.6) || near(p[0], box.x1, 0.6)) && (near(p[1], box.y0, 0.6) || near(p[1], box.y1, 0.6)));
}

/** Four curves that touch the middle of each side of the box: a circle or ellipse. */
function isEllipse(sub: PathSeg[], box: Box): boolean {
  const curves = sub.filter((s) => s.op === "C");
  if (curves.length !== 4 || sub.some((s) => s.op === "L")) return false;
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  if (w < 1 || h < 1) return false;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const tol = 0.03 * Math.max(w, h) + 0.3;
  return curves.every((c) => {
    const [x, y] = endOf(c);
    return (near(x, cx, tol) && (near(y, box.y0, tol) || near(y, box.y1, tol))) || (near(y, cy, tol) && (near(x, box.x0, tol) || near(x, box.x1, tol)));
  });
}

export type ShapeContext = {
  width: number;
  height: number;
  tables: Box[];
  bullets: Bullet[] | undefined;
  used: Pick<Decorated, "usedRules" | "usedFills">;
};

const within = (inner: Box, outer: Box, slack: number) =>
  inner.x0 >= outer.x0 - slack && inner.x1 <= outer.x1 + slack && inner.y0 >= outer.y0 - slack && inner.y1 <= outer.y1 + slack;

function isUsedRule(box: Box, rule: Rule): boolean {
  const horizontal = near(rule.y0, rule.y1, 0.6);
  if (horizontal) {
    return box.y1 - box.y0 <= 2.6 && near((box.y0 + box.y1) / 2, rule.y0, 1.5) && near(box.x0, Math.min(rule.x0, rule.x1), 2) && near(box.x1, Math.max(rule.x0, rule.x1), 2);
  }
  return box.x1 - box.x0 <= 2.6 && near((box.x0 + box.x1) / 2, rule.x0, 1.5) && near(box.y0, Math.min(rule.y0, rule.y1), 2) && near(box.y1, Math.max(rule.y0, rule.y1), 2);
}

/**
 * Drawn paths that are not already something else: table borders and shading, list bullets,
 * underlines and highlights are read elsewhere. What is left becomes shapes Word can edit.
 */
export function buildShapes(paths: PathShape[] | undefined, ctx: ShapeContext): { shapes: Shape[]; note?: string } {
  const out: Shape[] = [];
  const pageArea = ctx.width * ctx.height;
  let candidates = 0;
  for (const path of paths ?? []) {
    if (!path.segs.length || (!path.fill && !path.stroke)) continue;
    const subs = subpaths(path.segs).filter((s) => s.some((p) => p.pts.length));
    if (!subs.length) continue;
    const box = boxOf(path.segs);
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;
    if (!Number.isFinite(w + h)) continue;
    const white = path.fill !== undefined && /^f[ef]f[ef]f[ef]$/i.test(path.fill);
    const fill = path.fill;
    if (white && !path.stroke) continue;
    // A page-sized fill is a background. A near-white tint is only paper and is dropped; a dark or
    // coloured one (a slide, a cover) carries the light text printed on it, so it sits behind the text.
    const background = fill !== undefined && w * h >= pageArea * 0.85;
    if (background && luminance(fill) > PAPER_LUMINANCE && !path.stroke) continue;
    if (ctx.bullets?.some((b) => near(b.x0, box.x0, 1) && near(b.x1, box.x1, 1) && near(b.y0, box.y0, 1) && near(b.y1, box.y1, 1))) continue;
    if (ctx.used.usedRules.some((r) => isUsedRule(box, r))) continue;
    if (path.fill && ctx.used.usedFills.some((f) => near(f.x0, box.x0, 1) && near(f.x1, box.x1, 1) && near(f.y0, box.y0, 1) && near(f.y1, box.y1, 1))) continue;
    if (ctx.tables.some((t) => within(box, t, 3))) continue;
    candidates++;

    const base = {
      x: box.x0,
      y: box.y0,
      w,
      h,
      fill: fill?.toUpperCase(),
      stroke: path.stroke?.toUpperCase(),
      strokeWidth: path.width,
      fillAlpha: path.fillAlpha,
      strokeAlpha: path.strokeAlpha,
      dash: path.dash || undefined,
      behind: path.behind || background,
    };
    const only = subs.length === 1 ? subs[0] : null;
    if (only && !fill && only.filter((s) => s.op !== "Z").length === 2 && only[1].op === "L") {
      const [a, b] = [endOf(only[0]), endOf(only[1])];
      out.push({ kind: "line", ...base, flipV: (a[0] - b[0]) * (a[1] - b[1]) < 0 || undefined });
    } else if (only && isRect(only, box)) out.push({ kind: "rect", ...base });
    else if (only && isEllipse(only, box)) out.push({ kind: "ellipse", ...base });
    else {
      const rel = (seg: PathSeg): PathSeg => ({
        op: seg.op,
        pts: seg.pts.map((v, i) => Math.round((i % 2 === 0 ? v - box.x0 : v - box.y0) * 100) / 100),
      });
      out.push({ kind: "path", ...base, paths: subs.map((sub) => sub.map(rel)) });
    }
  }
  if (candidates > MAX_SHAPES) {
    return { shapes: [], note: `A page has more than ${MAX_SHAPES} small drawn graphics (outlined text or a detailed drawing), so they were left out.` };
  }
  return { shapes: out };
}
