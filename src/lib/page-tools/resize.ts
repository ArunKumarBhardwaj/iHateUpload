import { PDFDocument } from "@cantoo/pdf-lib";

import { drawUpright, embedUpright } from "./embed";
import { PAPER, toPoints } from "./geometry";
import type { PaperId, SizeUnit } from "./types";

export type ResizeSettings = {
  size: PaperId;
  /** Custom sheet, in `unit`. */
  width: number;
  height: number;
  unit: SizeUnit;
  /** letterbox keeps the whole page, fit fills the sheet and clips, stretch ignores the aspect ratio. */
  fit: "letterbox" | "fit" | "stretch";
  /** Off keeps the content at its own size, centred on the new sheet. */
  scale: boolean;
  /** keep: sheet as typed. auto: each page keeps its own orientation. */
  orientation: "auto" | "portrait" | "landscape";
  /** Zero-based pages to resize; null means all. Others are copied as they are. */
  pages: number[] | null;
};

export const DEFAULT_RESIZE: ResizeSettings = {
  size: "a4",
  width: 210,
  height: 297,
  unit: "mm",
  fit: "letterbox",
  scale: true,
  orientation: "auto",
  pages: null,
};

export function sheetPoints(s: ResizeSettings): [number, number] {
  if (s.size === "custom") {
    return [
      Math.max(10, toPoints(s.width, s.unit)),
      Math.max(10, toPoints(s.height, s.unit)),
    ];
  }
  return PAPER[s.size];
}

/** Sheet for one page after the orientation rule. */
export function sheetFor(
  s: ResizeSettings,
  page: { width: number; height: number },
): [number, number] {
  const [w, h] = sheetPoints(s);
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  if (s.orientation === "portrait") return [short, long];
  if (s.orientation === "landscape") return [long, short];
  return page.width > page.height ? [long, short] : [short, long];
}

export async function resizePages(
  source: PDFDocument,
  s: ResizeSettings,
  onProgress?: (ratio: number) => void,
): Promise<PDFDocument> {
  const out = await PDFDocument.create();
  const count = source.getPageCount();
  const chosen = s.pages ? new Set(s.pages) : null;
  for (let i = 0; i < count; i++) {
    const up = await embedUpright(out, source.getPage(i));
    if (chosen && !chosen.has(i)) {
      const page = out.addPage([up.width, up.height]);
      drawUpright(page, up, 0, 0, 1);
    } else {
      const [sw, sh] = sheetFor(s, up);
      const page = out.addPage([sw, sh]);
      let sx = 1;
      let sy = 1;
      if (s.scale) {
        const fitX = sw / up.width;
        const fitY = sh / up.height;
        if (s.fit === "stretch") {
          sx = fitX;
          sy = fitY;
        } else {
          sx = sy = s.fit === "fit" ? Math.max(fitX, fitY) : Math.min(fitX, fitY);
        }
      }
      drawUpright(
        page,
        up,
        (sw - up.width * sx) / 2,
        (sh - up.height * sy) / 2,
        sx,
        sy,
      );
    }
    onProgress?.((i + 1) / count);
  }
  return out;
}
