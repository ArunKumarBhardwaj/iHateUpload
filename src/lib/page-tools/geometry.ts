import type { PaperId, SizeUnit } from "./types";

export const PT_PER_MM = 72 / 25.4;

/** Paper in points, portrait. */
export const PAPER: Record<Exclude<PaperId, "custom">, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
  legal: [612, 1008],
  a3: [841.89, 1190.55],
  a5: [419.53, 595.28],
  tabloid: [792, 1224],
};

export const PAPER_TITLES: Record<PaperId, string> = {
  a4: "A4",
  letter: "Letter",
  legal: "Legal",
  a3: "A3",
  a5: "A5",
  tabloid: "Tabloid",
  custom: "Custom",
};

export function toPoints(value: number, unit: SizeUnit): number {
  return unit === "mm" ? value * PT_PER_MM : unit === "in" ? value * 72 : value;
}

export function fromPoints(points: number, unit: SizeUnit): number {
  return unit === "mm" ? points / PT_PER_MM : unit === "in" ? points / 72 : points;
}

export function normaliseTurn(degrees: number): 0 | 90 | 180 | 270 {
  return ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as
    | 0
    | 90
    | 180
    | 270;
}

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Maps a box drawn on the page as it is shown (top-left origin, ratios of the
 * rotated page) onto PDF user space of the unrotated crop box.
 */
export function visualRatioToUser(
  box: Rect,
  crop: { x: number; y: number; width: number; height: number },
  rotation: number,
): { x: number; y: number; width: number; height: number } {
  const r = normaliseTurn(rotation);
  let ux: number, uy: number, uw: number, uh: number;
  switch (r) {
    case 0:
      ux = box.x;
      uy = 1 - box.y - box.h;
      uw = box.w;
      uh = box.h;
      break;
    case 90:
      // The shown top edge is the user-space left edge.
      ux = box.y;
      uy = box.x;
      uw = box.h;
      uh = box.w;
      break;
    case 180:
      ux = 1 - box.x - box.w;
      uy = box.y;
      uw = box.w;
      uh = box.h;
      break;
    default:
      ux = 1 - box.y - box.h;
      uy = 1 - box.x - box.w;
      uw = box.h;
      uh = box.w;
  }
  return {
    x: crop.x + ux * crop.width,
    y: crop.y + uy * crop.height,
    width: uw * crop.width,
    height: uh * crop.height,
  };
}

/** Margins in points of a ratio box on a page of the shown size. */
export function boxToMargins(box: Rect, width: number, height: number) {
  return {
    top: box.y * height,
    left: box.x * width,
    right: (1 - box.x - box.w) * width,
    bottom: (1 - box.y - box.h) * height,
  };
}

export function marginsToBox(
  m: { top: number; right: number; bottom: number; left: number },
  width: number,
  height: number,
): Rect {
  const clamp = (v: number) => Math.min(Math.max(v, 0), 0.98);
  const x = clamp(m.left / width);
  const y = clamp(m.top / height);
  const w = Math.max(0.02, 1 - x - clamp(m.right / width));
  const h = Math.max(0.02, 1 - y - clamp(m.bottom / height));
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

/** Order after moving `keys` (kept in their current order) to sit before index `insertBefore` of the old order. */
export function reorderKeys(
  order: string[],
  keys: string[],
  insertBefore: number,
): string[] {
  const moving = new Set(keys);
  const moved = order.filter((k) => moving.has(k));
  const head = order.slice(0, insertBefore).filter((k) => !moving.has(k));
  const tail = order.slice(insertBefore).filter((k) => !moving.has(k));
  return [...head, ...moved, ...tail];
}
