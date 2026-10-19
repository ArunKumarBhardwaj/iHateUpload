import type { PDFPage } from "@cantoo/pdf-lib";

import type { RatioBox } from "@/lib/tool-options";

export type PageFrame = {
  /** Crop box origin and size, in the page's own (unrotated) space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 0, 90, 180 or 270: how the page is turned when shown. */
  rotation: number;
};

export function pageFrame(page: PDFPage): PageFrame {
  const crop = page.getCropBox();
  const raw = page.getRotation().angle;
  const rotation = ((((Math.round(raw / 90) * 90) % 360) + 360) % 360);
  return { x: crop.x, y: crop.y, width: crop.width, height: crop.height, rotation };
}

export type BoxPlacement = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees, counter-clockwise about (x, y), for drawImage / drawText. */
  rotate: number;
};

/**
 * Maps a box drawn on the page as the person sees it (ratios, origin top-left)
 * to where pdf-lib must draw to land there, even on turned or cropped pages.
 */
export function boxToPlacement(frame: PageFrame, box: RatioBox): BoxPlacement {
  const turned = frame.rotation === 90 || frame.rotation === 270;
  const viewW = turned ? frame.height : frame.width;
  const viewH = turned ? frame.width : frame.height;
  // The corner of the box that is bottom-left as seen.
  const u = box.x;
  const v = box.y + box.h;
  const { x: cx, y: cy, width: W, height: H } = frame;
  let x: number;
  let y: number;
  switch (frame.rotation) {
    case 90:
      x = cx + v * W;
      y = cy + u * H;
      break;
    case 180:
      x = cx + W - u * W;
      y = cy + v * H;
      break;
    case 270:
      x = cx + W - v * W;
      y = cy + H - u * H;
      break;
    default:
      x = cx + u * W;
      y = cy + H - v * H;
  }
  return {
    x,
    y,
    width: box.w * viewW,
    height: box.h * viewH,
    rotate: frame.rotation,
  };
}

/** Axis-aligned rectangle the box covers in the page's own space. */
export function boxToUserRect(frame: PageFrame, box: RatioBox) {
  const p = boxToPlacement(frame, box);
  const a = (p.rotate * Math.PI) / 180;
  const cos = Math.round(Math.cos(a));
  const sin = Math.round(Math.sin(a));
  const corners = [
    [0, 0],
    [p.width, 0],
    [0, p.height],
    [p.width, p.height],
  ].map(([w, h]) => [p.x + w * cos - h * sin, p.y + w * sin + h * cos]);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    x0: Math.min(...xs),
    y0: Math.min(...ys),
    x1: Math.max(...xs),
    y1: Math.max(...ys),
  };
}
