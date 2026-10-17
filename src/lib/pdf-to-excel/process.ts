import { loadPdfJs } from "@/lib/pdfjs";
import type { FileItem, ResultItem } from "@/lib/job";
import type { ToolOptions } from "@/lib/tool-options";

import type { PageReader } from "../pdf-to-word/ocr";
import { renderPageCanvas } from "../pdf-to-word/raster";
import { createTableReader } from "./ocr";
import { sheetToCsv } from "./csv";
import { convertPdfToExcel, type ConvertDeps } from "./index";

type PdfWorker = InstanceType<Awaited<ReturnType<typeof loadPdfJs>>["PDFWorker"]>;
let spare: Promise<PdfWorker> | null = null;

/** Start pdf.js's worker before it is needed; the first file then skips the start-up wait. */
export function warmUp(): void {
  spare ??= loadPdfJs().then((pdfjs) => new pdfjs.PDFWorker());
  spare.catch(() => (spare = null));
}

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
      const worker = await spare?.catch(() => undefined);
      pdf = await pdfjs.getDocument({ data, fontExtraProperties: true, worker: worker && !worker.destroyed ? worker : undefined }).promise;
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
        reader ??= await createTableReader(options.language, (r) => onPage(r));
        const base = page.getViewport({ scale: 1 });
        const longest = Math.max(base.width, base.height);
        const read = async (scale: number, from: number, to: number) => {
          onPage = (r) => progress(from + (to - from) * r);
          const canvas = await renderPageCanvas(page, scale);
          try {
            return await reader!.read(canvas, scale, base.height);
          } finally {
            canvas.width = canvas.height = 0;
          }
        };
        // A quick look at 2x tells how big the type is; small type is read again larger.
        const first = Math.min(2, 2400 / longest);
        const items = await read(first, 0, 0.3);
        const sizes = items.map((i) => i.size).sort((a, b) => a - b);
        const typical = sizes[Math.floor(sizes.length / 2)];
        const want = typical ? Math.min(5, 5200 / longest, Math.max(2.5, 32 / (0.72 * typical))) : Math.min(3, 3600 / longest);
        if (want <= first * 1.25) return items;
        return read(want, 0.3, 1);
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
        results.push({ id: crypto.randomUUID(), name: `${name}.xlsx`, size: blob.size, blob, originalSize: item.size, note, editor: result.editor });
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
