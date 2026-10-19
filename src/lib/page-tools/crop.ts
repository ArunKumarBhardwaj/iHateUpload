import type { PDFDocument } from "@cantoo/pdf-lib";

import { visualRatioToUser } from "./geometry";
import type { RatioRect } from "./types";

/**
 * Crops each page to a box drawn on the page as shown. Pages with a /Rotate
 * and crop boxes that do not start at the origin come out right.
 */
export function cropPages(
  doc: PDFDocument,
  rectFor: (pageIndex: number) => RatioRect | null,
) {
  doc.getPages().forEach((page, index) => {
    const rect = rectFor(index);
    if (!rect) return;
    const box = visualRatioToUser(
      rect,
      page.getCropBox(),
      page.getRotation().angle,
    );
    page.setCropBox(box.x, box.y, box.width, box.height);
    page.setMediaBox(box.x, box.y, box.width, box.height);
  });
}
