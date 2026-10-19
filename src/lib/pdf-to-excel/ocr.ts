import { createOcrWorker } from "../tesseract";
import { ocrBlocksToItems } from "../pdf-to-word/ocr";
import type { PageReader } from "../pdf-to-word/ocr";

type Word = { text?: string; confidence?: number };
type Blocks = { paragraphs?: { lines?: { words?: Word[] }[] }[] }[];

/**
 * Short words ("in", "qt", "5") are real in a table, but Tesseract is unsure of them, and the shared
 * reader drops unsure two-character words. They are rescued here before it sees them.
 */
export function keepShortWords(blocks: Blocks | null | undefined): Blocks {
  for (const block of blocks ?? []) {
    for (const p of block.paragraphs ?? []) {
      for (const line of p.lines ?? []) {
        for (const w of line.words ?? []) if (/^[A-Za-z0-9]{1,2}$/.test(w.text?.trim() ?? "")) w.confidence = Math.max(w.confidence ?? 0, 60);
      }
    }
  }
  return blocks ?? [];
}

/**
 * Table rules read as letters and swallow the rows next to them, so long straight dark runs are
 * painted white before the page is read. Works on RGBA pixels in place; returns how many it cleared.
 */
export function eraseRules(data: Uint8ClampedArray, width: number, height: number): number {
  const dark = (i: number) => data[i * 4 + 3] > 0 && data[i * 4] * 0.3 + data[i * 4 + 1] * 0.59 + data[i * 4 + 2] * 0.11 < 150;
  const minAcross = Math.max(30, Math.round(width * 0.06));
  const minDown = Math.max(30, Math.round(height * 0.04));
  const clear = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    let run = 0;
    for (let x = 0; x <= width; x++) {
      if (x < width && dark(y * width + x)) run++;
      else {
        if (run >= minAcross) for (let k = x - run; k < x; k++) clear[y * width + k] = 1;
        run = 0;
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let run = 0;
    for (let y = 0; y <= height; y++) {
      if (y < height && dark(y * width + x)) run++;
      else {
        if (run >= minDown) for (let k = y - run; k < y; k++) clear[k * width + x] = 1;
        run = 0;
      }
    }
  }
  let cleared = 0;
  for (let i = 0; i < clear.length; i++) {
    if (!clear[i]) continue;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = 255;
    cleared++;
  }
  return cleared;
}

type TessWorker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;

/**
 * A Tesseract reader that treats the page as one block of rows. The automatic mode splits a table
 * into columns and loses whole ones; reading across the rows keeps each row's cells together.
 */
export async function createTableReader(language: string, onPage: (ratio: number) => void): Promise<PageReader> {
  const { PSM } = await import("tesseract.js");
  const worker: TessWorker = await createOcrWorker(language, {
    logger: (message) => {
      if (message.status === "recognizing text") onPage(message.progress);
    },
  });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK, preserve_interword_spaces: "1" });
  return {
    async read(canvas, scale, pageHeight) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        if (eraseRules(image.data, canvas.width, canvas.height)) ctx.putImageData(image, 0, 0);
      }
      const result = await worker.recognize(canvas, {}, { blocks: true });
      return ocrBlocksToItems(keepShortWords(result.data.blocks as Blocks) as never, scale, pageHeight);
    },
    close: () => worker.terminate().then(() => undefined),
  };
}
