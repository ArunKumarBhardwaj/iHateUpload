import { loadPdfJs } from "@/lib/pdfjs";
import type { FileItem, ResultItem } from "@/lib/job";
import type { ConvertDeps } from "@/lib/pdf-to-word";
import { createPageReader, type PageReader } from "@/lib/pdf-to-word/ocr";
import { canvasToJpeg, rasterizeImage, renderPageCanvas } from "@/lib/pdf-to-word/raster";
import { resolvePageRange, type ToolOptions } from "@/lib/tool-options";

import { convertPdfToHtml } from "./convert";

/** Past this the preview frame would be slow to load; the download is unaffected. */
const PREVIEW_LIMIT = 12 * 1024 * 1024;

export async function processPdfToHtml(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "pdf-to-html") throw new Error("PDF to HTML needs its options.");
  if (files.length === 0) throw new Error("Choose a PDF to convert.");
  const pdfjs = await loadPdfJs();
  const results: ResultItem[] = [];

  for (let index = 0; index < files.length; index++) {
    const item = files[index];
    const report = (ratio: number) => onProgress(Math.min(0.99, (index + ratio) / files.length));
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: new Uint8Array(await item.file.arrayBuffer()), fontExtraProperties: true }).promise;
    } catch (error) {
      if ((error as { name?: string }).name === "PasswordException") {
        throw new Error(`${item.name} is locked. Unlock it first, then convert.`);
      }
      throw new Error(`${item.name} could not be opened as a PDF. Try Repair PDF first.`);
    }
    let reader: PageReader | null = null;
    let onPage: (ratio: number) => void = () => {};
    const deps: ConvertDeps = {
      OPS: pdfjs.OPS as unknown as Record<string, number>,
      rasterizeImage,
      renderJpeg: async (page) => {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2.5, 3600 / Math.max(base.width, base.height));
        const canvas = await renderPageCanvas(page, scale);
        try {
          return await canvasToJpeg(canvas, 0.85);
        } finally {
          canvas.width = canvas.height = 0;
        }
      },
      readScan: async (page, _pageNo, progress) => {
        onPage = progress;
        reader ??= await createPageReader(options.language, (r) => onPage(r));
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(3, 3600 / Math.max(base.width, base.height));
        const canvas = await renderPageCanvas(page, scale);
        try {
          return await reader.read(canvas, scale, base.height);
        } finally {
          canvas.width = canvas.height = 0;
        }
      },
    };
    try {
      const pages = resolvePageRange(options.range, pdf.numPages).map((i) => i + 1);
      const name = item.name.replace(/\.[^.]+$/, "");
      const result = await convertPdfToHtml(pdf as never, name, { mode: options.mode, output: options.output, pages }, deps, report);
      const zipped = options.output === "zip" && result.zipBytes;
      const blob = zipped
        ? new Blob([result.zipBytes as BlobPart], { type: "application/zip" })
        : new Blob([result.html], { type: "text/html;charset=utf-8" });
      results.push({
        id: crypto.randomUUID(),
        name: zipped ? `${name}-html.zip` : `${name}.html`,
        size: blob.size,
        blob,
        originalSize: item.size,
        note: [`${result.pages} page${result.pages === 1 ? "" : "s"}.`, ...result.notes].join(" "),
        htmlPreview: result.html.length <= PREVIEW_LIMIT ? result.html : undefined,
      });
    } finally {
      const open = reader as PageReader | null;
      if (open) await open.close();
      await pdf.loadingTask.destroy();
    }
    report(1);
  }
  return results;
}
