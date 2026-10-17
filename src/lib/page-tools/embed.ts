import {
  PDFDocument,
  PDFName,
  PDFPage,
  degrees,
  type PDFEmbeddedPage,
} from "@cantoo/pdf-lib";

import { normaliseTurn } from "./geometry";

export type Upright = {
  embedded: PDFEmbeddedPage;
  /** Size as shown, after the page's own /Rotate. */
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
};

/**
 * Copies a page into `out` as a vector form. The visible area is the crop
 * box, and the page's /Rotate is remembered so it can be drawn upright.
 */
export async function embedUpright(
  out: PDFDocument,
  page: PDFPage,
): Promise<Upright> {
  // pdf-lib refuses pages with no content stream.
  if (!page.node.has(PDFName.of("Contents"))) {
    page.drawRectangle({ x: 0, y: 0, width: 0.01, height: 0.01, opacity: 0 });
  }
  const crop = page.getCropBox();
  const embedded = await out.embedPage(page, {
    left: crop.x,
    bottom: crop.y,
    right: crop.x + crop.width,
    top: crop.y + crop.height,
  });
  const rotation = normaliseTurn(page.getRotation().angle);
  const turned = rotation === 90 || rotation === 270;
  return {
    embedded,
    width: turned ? crop.height : crop.width,
    height: turned ? crop.width : crop.height,
    rotation,
  };
}

/** Draws an embedded page with its visual bottom-left at (x, y), scaled by sx and sy. */
export function drawUpright(
  target: PDFPage,
  up: Upright,
  x: number,
  y: number,
  sx: number,
  sy = sx,
) {
  // sx and sy are visual scales; a quarter turn swaps which content axis they hit.
  const swap = up.rotation === 90 || up.rotation === 270;
  const xScale = swap ? sy : sx;
  const yScale = swap ? sx : sy;
  const w = up.embedded.width * xScale;
  const h = up.embedded.height * yScale;
  const base = { xScale, yScale };
  switch (up.rotation) {
    case 0:
      target.drawPage(up.embedded, { ...base, x, y });
      break;
    case 90:
      target.drawPage(up.embedded, {
        ...base,
        x,
        y: y + w,
        rotate: degrees(-90),
      });
      break;
    case 180:
      target.drawPage(up.embedded, {
        ...base,
        x: x + w,
        y: y + h,
        rotate: degrees(180),
      });
      break;
    case 270:
      target.drawPage(up.embedded, {
        ...base,
        x: x + h,
        y,
        rotate: degrees(90),
      });
      break;
  }
}
