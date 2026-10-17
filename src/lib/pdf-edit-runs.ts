/** What the original line looks like, so a replacement can match it. */
export type RunFont = {
  family: "helvetica" | "times" | "courier";
  bold: boolean;
  italic: boolean;
};

/** Reads a PDF font name such as "ABCDEF+Arial-BoldMT" into a standard family. */
export function fontFromName(name: string | undefined, css?: string): RunFont {
  const n = `${name ?? ""} ${css ?? ""}`.replace(/[A-Z]{6}\+/, "").toLowerCase();
  const family: RunFont["family"] = /courier|mono|consolas/.test(n)
    ? "courier"
    : /times|serif|georgia|garamond|palatino|minion|cambria/.test(n) && !/sans/.test(n)
      ? "times"
      : "helvetica";
  return {
    family,
    bold: /bold|black|heavy|demi/.test(n),
    italic: /italic|oblique/.test(n),
  };
}

export type PageTextRun = {
  font?: RunFont;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type PdfJsLikeItem = {
  fontName?: string;
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
};

export function pdfJsItemsToRuns(
  items: PdfJsLikeItem[],
  pageWidth: number,
  pageHeight: number,
  toViewport: (x: number, y: number) => { x: number; y: number },
  fontOf?: (fontName: string | undefined) => RunFont | undefined,
): PageTextRun[] {
  const width = Math.max(1, pageWidth);
  const height = Math.max(1, pageHeight);
  const runs: PageTextRun[] = [];
  for (const item of items) {
    const text = item.str ?? "";
    if (!text.trim()) continue;
    const tm = item.transform;
    if (!tm || tm.length < 6) continue;
    const itemWidth = Number(item.width) || 0;
    const itemHeight = Number(item.height) || Math.abs(Number(tm[3]) || 0);
    const a = toViewport(tm[4], tm[5]);
    const b = toViewport(tm[4] + itemWidth, tm[5]);
    const c = toViewport(tm[4], tm[5] + itemHeight);
    const left = Math.min(a.x, b.x, c.x);
    const right = Math.max(a.x, b.x, c.x);
    const top = Math.min(a.y, b.y, c.y);
    const bottom = Math.max(a.y, b.y, c.y);
    const w = (right - left) / width;
    const h = (bottom - top) / height;
    if (w <= 0 || h <= 0) continue;
    runs.push({
      text,
      x: left / width,
      y: top / height,
      w,
      h,
      font: fontOf?.(item.fontName),
    });
  }
  return runs;
}

export function mergeTextRuns(items: PageTextRun[]): PageTextRun[] {
  const sorted = items
    .filter((run) => run.text.trim().length > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const lines: PageTextRun[] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push({ ...item });
      continue;
    }
    const sameRow = Math.abs(item.y - last.y) <= Math.max(item.h, last.h) * 0.6;
    const gap = item.x - (last.x + last.w);
    const close = gap >= -0.012 && gap <= Math.max(0.028, last.h * 1.8);
    if (!sameRow || !close) {
      lines.push({ ...item });
      continue;
    }
    const space = gap > Math.max(0.004, last.h * 0.18) ? " " : "";
    const x = Math.min(last.x, item.x);
    const y = Math.min(last.y, item.y);
    const x2 = Math.max(last.x + last.w, item.x + item.w);
    const y2 = Math.max(last.y + last.h, item.y + item.h);
    last.text = `${last.text}${space}${item.text}`;
    last.x = x;
    last.y = y;
    last.w = x2 - x;
    last.h = y2 - y;
  }
  return lines;
}

export function hitTextRun(
  runs: PageTextRun[],
  x: number,
  y: number,
): PageTextRun | null {
  let best: PageTextRun | null = null;
  let bestArea = Infinity;
  for (const run of runs) {
    if (x < run.x || y < run.y || x > run.x + run.w || y > run.y + run.h) {
      continue;
    }
    const area = run.w * run.h;
    if (area < bestArea) {
      best = run;
      bestArea = area;
    }
  }
  return best;
}

export function textMarkBox(run: PageTextRun) {
  const x = clamp(run.x - 0.004, 0, 0.95);
  const y = clamp(run.y - 0.003, 0, 0.95);
  return {
    x,
    y,
    w: clamp(run.w + 0.01, 0.05, 1 - x),
    h: clamp(run.h + 0.008, 0.016, 1 - y),
    fontSize: clamp(run.h * 0.9, 0.01, 0.08),
  };
}

export function ocrWordsToRuns(
  words: Array<{
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
  }>,
  renderWidth: number,
  renderHeight: number,
): PageTextRun[] {
  const width = Math.max(1, renderWidth);
  const height = Math.max(1, renderHeight);
  const runs: PageTextRun[] = [];
  for (const word of words) {
    const text = word.text.trim();
    if (!text) continue;
    const w = (word.bbox.x1 - word.bbox.x0) / width;
    const h = (word.bbox.y1 - word.bbox.y0) / height;
    if (w <= 0 || h <= 0) continue;
    runs.push({
      text,
      x: word.bbox.x0 / width,
      y: word.bbox.y0 / height,
      w,
      h,
    });
  }
  return runs;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
