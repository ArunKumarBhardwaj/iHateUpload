import { loadPdfJs } from "@/lib/pdfjs";
import type { FileItem, ResultItem } from "@/lib/job";
import type { ToolOptions } from "@/lib/tool-options";

import { convertPdf, type ConvertDeps } from "./index";
import { createPageReader, type PageReader } from "./ocr";
import { canvasToJpeg, rasterizeImage, renderPageCanvas } from "./raster";

const DOCX_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function processPdfToWord(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "pdf-to-word") throw new Error("PDF to Word needs a mode.");
  if (files.length === 0) throw new Error("Choose a PDF to convert.");

  const pdfjs = await loadPdfJs();
  const results: ResultItem[] = [];

  for (let index = 0; index < files.length; index++) {
    const item = files[index];
    const share = 1 / files.length;
    const report = (ratio: number) => onProgress(Math.min(0.99, (index + ratio) * share));
    const data = new Uint8Array(await item.file.arrayBuffer());

    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data, fontExtraProperties: true }).promise;
    } catch (error) {
      if ((error as { name?: string }).name === "PasswordException") {
        throw new Error(`${item.name} is locked. Unlock it first, then convert.`);
      }
      throw new Error(`${item.name} could not be opened as a PDF.`);
    }

    let reader: PageReader | null = null;
    let onPage: (ratio: number) => void = () => {};
    const deps: ConvertDeps = {
      OPS: pdfjs.OPS as unknown as Record<string, number>,
      rasterizeImage,
      renderJpeg: async (page) => {
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 3200 / Math.max(base.width, base.height));
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
      const name = item.name.replace(/\.[^.]+$/, "");
      const result = await convertPdf(
        pdf as never,
        name,
        { mode: options.mode, language: options.language },
        deps,
        report,
      );
      const blob = new Blob([result.bytes as BlobPart], { type: DOCX_TYPE });
      results.push({
        id: crypto.randomUUID(),
        name: `${name}.docx`,
        size: blob.size,
        blob,
        originalSize: item.size,
        note: result.notes.length ? result.notes.join(" ") : undefined,
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
