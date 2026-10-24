/**
 * Reads every page of a PDF for Smart split, in the browser: the text layer
 * where there is one, OCR where the page is a picture, and ink on the page to
 * tell a blank separator sheet from a scan. One read per file per tab: the
 * options preview and the split itself share it.
 */
import { createPageReader, type PageReader } from "@/lib/pdf-to-word/ocr";
import { renderPageCanvas } from "@/lib/pdf-to-word/raster";
import { loadPdfJs } from "@/lib/pdfjs";

import { linesFromItems, type PageInfo } from "./detect";

/** Dark pixels, as a share of the page, below which a page with no text is a blank sheet. */
const BLANK_INK = 0.0015;

type Progress = (done: number, total: number) => void;

const cache = new WeakMap<File, Promise<PageInfo[]>>();
const listeners = new WeakMap<File, Set<Progress>>();

/** The pages of `file`, read once; `onProgress` hears how many pages are done. */
export function readSmartPages(file: File, onProgress?: Progress): Promise<PageInfo[]> {
  if (onProgress) {
    const set = listeners.get(file) ?? new Set();
    set.add(onProgress);
    listeners.set(file, set);
  }
  let job = cache.get(file);
  if (!job) {
    job = readPages(file, (done, total) => listeners.get(file)?.forEach((fn) => fn(done, total)));
    cache.set(file, job);
    job.catch(() => cache.delete(file));
  }
  return job;
}

function inkShare(canvas: HTMLCanvasElement): number {
  const small = document.createElement("canvas");
  small.width = 200;
  small.height = Math.max(1, Math.round((200 * canvas.height) / canvas.width));
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 1;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const { data } = ctx.getImageData(0, 0, small.width, small.height);
  let dark = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11 < 150) dark++;
  small.width = small.height = 0;
  return dark / (data.length / 4);
}

async function readPages(file: File, onProgress: Progress): Promise<PageInfo[]> {
  const pdfjs = await loadPdfJs();
  let pdf;
  try {
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch (error) {
    if ((error as { name?: string }).name === "PasswordException") throw new Error("This PDF is locked. Unlock it first, then split it.");
    throw new Error("This file could not be opened as a PDF. Try Repair PDF first.");
  }
  let reader: PageReader | null = null;
  const pages: PageInfo[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const { width, height } = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items = content.items.flatMap((raw) => {
        if (!("str" in raw) || !raw.str.trim()) return [];
        const t = raw.transform as number[];
        return [{ str: raw.str, x: t[4], y: height - t[5], size: Math.hypot(t[2], t[3]) || 10, font: raw.fontName }];
      });
      let lines = linesFromItems(items, height, width);
      const fonts = [...new Set(items.map((i) => content.styles[i.font]?.fontFamily + "/" + i.font))];
      let blank = false;
      let scanned = false;
      if (!lines.some((l) => /\p{L}{2}/u.test(l.text))) {
        // No text layer: a scan or a blank sheet. Look at the ink, then read the words with OCR.
        const scale = Math.min(2.5, 2000 / Math.max(width, height));
        const canvas = await renderPageCanvas(page, scale);
        try {
          const ink = inkShare(canvas);
          if (ink < BLANK_INK / 10) blank = true;
          else {
            reader ??= await createPageReader("eng", () => {});
            const read = await reader.read(canvas, scale, height);
            lines = linesFromItems(read.map((w) => ({ str: w.str, x: w.x, y: w.y, size: w.size })), height, width);
            // Little ink and no words: a blank sheet with specks. A line of words, like a signature, is a page.
            const words = lines.some((l) => /\p{L}{3}/u.test(l.text));
            if (!words && ink < BLANK_INK) blank = true;
            else scanned = true;
          }
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      pages.push({ lines, width, height, blank, scanned, fonts: scanned ? undefined : fonts });
      page.cleanup();
      onProgress(n, pdf.numPages);
    }
  } finally {
    const r = reader as PageReader | null;
    if (r) await r.close();
    await pdf.loadingTask.destroy();
  }
  return pages;
}
