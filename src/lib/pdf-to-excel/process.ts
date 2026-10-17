import { loadPdfJs } from "@/lib/pdfjs";
import type { FileItem, ResultItem } from "@/lib/job";
import type { ToolOptions } from "@/lib/tool-options";

import { createPageReader, type PageReader } from "../pdf-to-word/ocr";
import { renderPageCanvas } from "../pdf-to-word/raster";
import { sheetToCsv } from "./csv";
import { convertPdfToExcel, type ConvertDeps } from "./index";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function processPdfToExcel(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "pdf-to-excel") throw new Error("PDF to Excel needs its options.");
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
      readScan: async (page, _pageNo, progress) => {
        onPage = progress;
        reader ??= await createPageReader(options.language, (r) => onPage(r));
        const base = page.getViewport({ scale: 1 });
        // Tables are small type; a larger raster reads digits and letters like q and g more reliably.
        const scale = Math.min(4, 4400 / Math.max(base.width, base.height));
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
      const result = await convertPdfToExcel(
        pdf as never,
        name,
        {
          layout: options.layout,
          includeText: options.includeText,
          typed: options.typed,
          formatting: options.formatting,
          freezeFilter: options.freezeFilter,
          joinPages: options.joinPages,
          language: options.language,
          range: options.range,
        },
        deps,
        report,
      );
      const note = result.notes.length ? result.notes.join(" ") : undefined;
      if (options.format === "csv") {
        const { sheets } = result.book;
        sheets.forEach((sheet, k) => {
          const blob = new Blob([sheetToCsv(sheet)], { type: "text/csv;charset=utf-8" });
          results.push({
            id: crypto.randomUUID(),
            name: sheets.length === 1 ? `${name}.csv` : `${name} - ${sheet.name.replace(/[\\/:*?"<>|]/g, " ")}.csv`,
            size: blob.size,
            blob,
            originalSize: item.size,
            note: k === 0 ? note : undefined,
          });
        });
      } else {
        const blob = new Blob([result.bytes as BlobPart], { type: XLSX_TYPE });
        results.push({ id: crypto.randomUUID(), name: `${name}.xlsx`, size: blob.size, blob, originalSize: item.size, note });
      }
    } finally {
      const open = reader as PageReader | null;
      if (open) await open.close();
      await pdf.loadingTask.destroy();
    }
    report(1);
  }
  return results;
}
