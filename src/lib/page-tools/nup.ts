import { PDFDocument, rgb } from "@cantoo/pdf-lib";

import { drawUpright, embedUpright } from "./embed";
import { PAPER, PT_PER_MM } from "./geometry";
import type { NupOrientation, NupPaper } from "./types";

export type NupSettings = {
  cols: number;
  rows: number;
  paper: NupPaper;
  orientation: NupOrientation;
  /** Millimetres. */
  margin: number;
  /** Millimetres. */
  gap: number;
  border: boolean;
  order: "across" | "down";
};

export const NUP_PRESETS: { n: number; cols: number; rows: number }[] = [
  { n: 2, cols: 2, rows: 1 },
  { n: 4, cols: 2, rows: 2 },
  { n: 6, cols: 3, rows: 2 },
  { n: 9, cols: 3, rows: 3 },
  { n: 16, cols: 4, rows: 4 },
];

export const DEFAULT_NUP: NupSettings = {
  cols: 2,
  rows: 1,
  paper: "a4",
  orientation: "auto",
  margin: 8,
  gap: 4,
  border: false,
  order: "across",
};

export type Cell = { x: number; y: number; w: number; h: number };

/** Cells in reading order for the fill direction; y is from the bottom of the sheet. */
export function nupCells(
  s: Pick<NupSettings, "cols" | "rows" | "margin" | "gap" | "order">,
  sheetW: number,
  sheetH: number,
): Cell[] {
  const margin = s.margin * PT_PER_MM;
  const gap = s.gap * PT_PER_MM;
  const w = (sheetW - 2 * margin - gap * (s.cols - 1)) / s.cols;
  const h = (sheetH - 2 * margin - gap * (s.rows - 1)) / s.rows;
  const at = (col: number, row: number): Cell => ({
    x: margin + col * (w + gap),
    y: sheetH - margin - (row + 1) * h - row * gap,
    w,
    h,
  });
  const cells: Cell[] = [];
  if (s.order === "across") {
    for (let r = 0; r < s.rows; r++) for (let c = 0; c < s.cols; c++) cells.push(at(c, r));
  } else {
    for (let c = 0; c < s.cols; c++) for (let r = 0; r < s.rows; r++) cells.push(at(c, r));
  }
  return cells;
}

/** Sheet size in points for the paper and orientation; "auto" picks what fits the pages best. */
export function nupSheet(
  s: NupSettings,
  firstPage: { width: number; height: number },
): { width: number; height: number } {
  const [pw, ph] = PAPER[s.paper];
  const portrait = { width: pw, height: ph };
  const landscape = { width: ph, height: pw };
  if (s.orientation === "portrait") return portrait;
  if (s.orientation === "landscape") return landscape;
  const score = (sheet: { width: number; height: number }) => {
    const cell = nupCells(s, sheet.width, sheet.height)[0];
    return Math.min(cell.w / firstPage.width, cell.h / firstPage.height);
  };
  return score(landscape) > score(portrait) ? landscape : portrait;
}

export async function buildNup(
  source: PDFDocument,
  s: NupSettings,
  onProgress?: (ratio: number) => void,
): Promise<PDFDocument> {
  const count = source.getPageCount();
  const perSheet = s.cols * s.rows;
  const out = await PDFDocument.create();
  const first = source.getPage(0).getCropBox();
  const rot = source.getPage(0).getRotation().angle % 180 !== 0;
  const sheet = nupSheet(s, {
    width: rot ? first.height : first.width,
    height: rot ? first.width : first.height,
  });
  const cells = nupCells(s, sheet.width, sheet.height);
  const sheets = Math.ceil(count / perSheet);
  for (let si = 0; si < sheets; si++) {
    const page = out.addPage([sheet.width, sheet.height]);
    for (let slot = 0; slot < perSheet; slot++) {
      const index = si * perSheet + slot;
      if (index >= count) break;
      const cell = cells[slot];
      const up = await embedUpright(out, source.getPage(index));
      const scale = Math.min(cell.w / up.width, cell.h / up.height);
      const w = up.width * scale;
      const h = up.height * scale;
      const x = cell.x + (cell.w - w) / 2;
      const y = cell.y + (cell.h - h) / 2;
      drawUpright(page, up, x, y, scale);
      if (s.border) {
        page.drawRectangle({
          x,
          y,
          width: w,
          height: h,
          borderColor: rgb(0.45, 0.45, 0.45),
          borderWidth: 0.6,
        });
      }
    }
    onProgress?.((si + 1) / sheets);
  }
  return out;
}
