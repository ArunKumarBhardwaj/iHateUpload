import { itemsToLines } from "@/lib/pdf-text";
import { loadPdfJs } from "@/lib/pdfjs";
import { createOcrWorker } from "@/lib/tesseract";

/** A page with fewer visible characters than this is treated as a scan. */
export const SCANNED_PAGE_CHARS = 3;

export type TextExtractOptions = {
  ocr: boolean;
  language: string;
  onProgress: (ratio: number) => void;
};

export function pageSeparator(pageNum: number): string {
  return `--- Page ${pageNum} ---`;
}

export function joinPages(pages: string[]): string {
  return pages
    .map((text, i) => `${pageSeparator(i + 1)}\n${text}`)
    .join("\n\n")
    .trim();
}

type TessWorker = Awaited<
  ReturnType<(typeof import("tesseract.js"))["createWorker"]>
>;

async function makeWorker(language: string, onProgress: (r: number) => void) {
  let page = { at: 0, of: 1 };
  const worker = await createOcrWorker(language, {
    logger: (m) => {
      if (m.status === "recognizing text") {
        onProgress(Math.min(0.98, (page.at + m.progress) / page.of));
      }
    },
  });
  return {
    worker,
    setPage: (at: number, of: number) => {
      page = { at, of };
    },
  };
}

async function recognize(worker: TessWorker, image: HTMLCanvasElement | Blob) {
  const result = await worker.recognize(image);
  return (result.data.text ?? "").trim();
}

/** Pages of a PDF as text; scanned pages are read with OCR when asked. */
export async function extractPdfPages(
  file: File,
  options: TextExtractOptions,
): Promise<{ pages: string[]; ocrPages: number[] }> {
  const { getDocument } = await loadPdfJs();
  const doc = await getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  const pages: string[] = [];
  const ocrPages: number[] = [];
  let ocr: Awaited<ReturnType<typeof makeWorker>> | null = null;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      let text = itemsToLines((await page.getTextContent()).items);
      if (text.replace(/\s/g, "").length < SCANNED_PAGE_CHARS && options.ocr) {
        ocr ??= await makeWorker(options.language, options.onProgress);
        ocr.setPage(n - 1, doc.numPages);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is not available in this browser.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        text = await recognize(ocr.worker, canvas);
        ocrPages.push(n);
        canvas.width = 0;
        canvas.height = 0;
      }
      pages.push(text);
      page.cleanup();
      options.onProgress(n / doc.numPages);
    }
  } finally {
    await ocr?.worker.terminate();
    await doc.loadingTask.destroy();
  }
  return { pages, ocrPages };
}

export async function extractImageText(
  file: File,
  options: TextExtractOptions,
): Promise<string> {
  const { worker } = await makeWorker(options.language, options.onProgress);
  try {
    return await recognize(worker, file);
  } finally {
    await worker.terminate();
  }
}
