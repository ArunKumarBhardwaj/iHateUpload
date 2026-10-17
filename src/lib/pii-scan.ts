import type { PDFPageProxy } from "pdfjs-dist";

import { recognizePageWords } from "@/lib/edit-ocr";
import {
  detectPii,
  matchBoxes,
  spansToPageText,
  type PiiCategory,
  type TextSpan,
} from "@/lib/pii-detect";
import { loadPdfJs } from "@/lib/pdfjs";
import type { RedactFinding } from "@/lib/tool-options";

/** A page with fewer letters than this is treated as a scan and read with OCR. */
const SCAN_TEXT_FLOOR = 25;
const OCR_SCALE = 2;

export type ScanProgress = (done: number, total: number, usedOcr: boolean) => void;

/**
 * Reads every page, finds personal data, and returns one finding per line it
 * sits on. Text pages use the PDF's own text; scans go through OCR in this tab.
 */
export async function scanPdfForPii(
  file: File,
  options: {
    custom: string;
    categories?: Set<PiiCategory>;
    onProgress?: ScanProgress;
    signal?: { cancelled: boolean };
  },
): Promise<RedactFinding[]> {
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const findings: RedactFinding[] = [];
  try {
    for (let p = 0; p < doc.numPages; p++) {
      if (options.signal?.cancelled) break;
      const page = await doc.getPage(p + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let spans: TextSpan[] = [];
      let letters = 0;
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        letters += item.str.replace(/\s/g, "").length;
        const t = pdfjs.Util.transform(viewport.transform, item.transform);
        const size = Math.hypot(t[2], t[3]);
        const w = item.width * viewport.scale;
        spans.push({
          text: item.str,
          x: t[4] / viewport.width,
          y: (t[5] - size * 0.86) / viewport.height,
          w: w / viewport.width,
          h: (size * 1.1) / viewport.height,
        });
      }
      let usedOcr = false;
      if (letters < SCAN_TEXT_FLOOR) {
        usedOcr = true;
        spans = await ocrSpans(page);
      }
      page.cleanup();

      const pageText = spansToPageText(spans);
      const matches = detectPii(pageText.text, {
        custom: options.custom,
        categories: options.categories,
      });
      matches.forEach((match, mi) => {
        matchBoxes(pageText, match).forEach((box, bi) => {
          findings.push({
            id: `${p}-${mi}-${bi}`,
            pageIndex: p,
            ...box,
            category: match.category,
            text: match.text,
            accepted: true,
          });
        });
      });
      options.onProgress?.(p + 1, doc.numPages, usedOcr);
    }
  } finally {
    await doc.loadingTask.destroy();
  }
  return findings;
}

async function ocrSpans(page: PDFPageProxy): Promise<TextSpan[]> {
  const viewport = page.getViewport({ scale: OCR_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  const w = canvas.width;
  const h = canvas.height;
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) return [];
  const words = await recognizePageWords(blob);
  return words.map((word) => ({
    text: word.text,
    x: word.bbox.x0 / w,
    y: word.bbox.y0 / h,
    w: (word.bbox.x1 - word.bbox.x0) / w,
    h: (word.bbox.y1 - word.bbox.y0) / h,
  }));
}
