import type { TextItem } from "./lines";

type Bbox = { x0: number; y0: number; x1: number; y1: number };
type OcrWord = { text?: string; confidence?: number; bbox: Bbox };
type OcrLine = { bbox: Bbox; words?: OcrWord[] };
type OcrBlock = { paragraphs?: { lines?: OcrLine[] }[] };

/**
 * Tesseract blocks to the same text items pdf.js gives, so scans run through
 * the normal layout. `scale` is pixels per point; `pageHeight` is in points.
 */
export function ocrBlocksToItems(
  blocks: OcrBlock[] | null | undefined,
  scale: number,
  pageHeight: number,
): TextItem[] {
  const items: TextItem[] = [];
  const all: OcrLine[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) if (line.words?.length) all.push(line);
    }
  }
  const heights = all.map((l) => (l.bbox.y1 - l.bbox.y0) / scale).sort((a, b) => a - b);
  const typical = heights[Math.floor(heights.length / 2)] ?? 10;
  for (const line of all) {
    const height = (line.bbox.y1 - line.bbox.y0) / scale;
    // Lines near the page's usual height share one size; clearly bigger ones stay bigger.
    const basis = Math.abs(height - typical) <= typical * 0.3 ? typical : height;
    const size = Math.max(6, Math.min(72, basis / 0.95));
    const baseline = Math.min(pageHeight, line.bbox.y1 / scale - size * 0.18);
    for (const word of line.words ?? []) {
      const text = word.text?.trim() ?? "";
      if (!text) continue;
      if ((word.confidence ?? 100) < 25 && text.length <= 2) continue;
      items.push({
        str: text,
        x: word.bbox.x0 / scale,
        y: baseline,
        w: Math.max(1, (word.bbox.x1 - word.bbox.x0) / scale),
        size,
        font: "Arial",
        bold: false,
        italic: false,
        generic: "sans",
      });
    }
  }
  return items;
}

type TessWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

export type PageReader = {
  read: (canvas: HTMLCanvasElement, scale: number, pageHeight: number) => Promise<TextItem[]>;
  close: () => Promise<void>;
};

/** One Tesseract worker for the whole file. `onPage` reports 0..1 for the page being read. */
export async function createPageReader(
  language: string,
  onPage: (ratio: number) => void,
): Promise<PageReader> {
  const { createWorker, PSM } = await import("tesseract.js");
  const worker: TessWorker = await createWorker(language, 1, {
    logger: (message) => {
      if (message.status === "recognizing text") onPage(message.progress);
    },
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
  return {
    async read(canvas, scale, pageHeight) {
      const result = await worker.recognize(canvas, {}, { blocks: true });
      return ocrBlocksToItems(result.data.blocks as OcrBlock[], scale, pageHeight);
    },
    close: () => worker.terminate().then(() => undefined),
  };
}
