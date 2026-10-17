import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import { extractPage } from "../pdf-to-word/extract";
import type { PageInput } from "../pdf-to-word/lines";
import { resolvePageRange } from "../tool-options";
import { pagesToWorkbook, type ExcelLayout } from "./convert";
import { writeXlsx } from "./xlsx-writer";

export type ConvertOptions = {
  layout: ExcelLayout;
  includeText: boolean;
  /** OCR language for pages with no text layer. */
  language: string;
  /** Empty or "all" is every page. */
  range: string;
};

/** The parts that need a browser. Tests swap them for stand-ins. */
export type ConvertDeps = {
  OPS: Record<string, number>;
  /** Read a page with no text layer. Returns text items in points, or null to skip. */
  readScan?: (page: PDFPageProxy, pageNo: number, onPage: (ratio: number) => void) => Promise<PageInput["items"] | null>;
};

export type ConvertResult = { bytes: Uint8Array; notes: string[]; pages: number; tables: number };

const SCAN_CHARS = 20;

function pagesPhrase(numbers: number[]): string {
  if (numbers.length === 1) return `Page ${numbers[0]}`;
  if (numbers.length <= 4) return `Pages ${numbers.join(", ")}`;
  return `Pages ${numbers.slice(0, 4).join(", ")} and ${numbers.length - 4} more`;
}

export async function convertPdfToExcel(
  pdf: PDFDocumentProxy,
  title: string,
  options: ConvertOptions,
  deps: ConvertDeps,
  onProgress: (ratio: number) => void,
): Promise<ConvertResult> {
  const picked = resolvePageRange(options.range, pdf.numPages);
  const inputs: PageInput[] = [];
  const numbers: number[] = [];
  const scanned: number[] = [];
  const unreadable: number[] = [];

  for (let k = 0; k < picked.length; k++) {
    const n = picked[k] + 1;
    const base = k / picked.length;
    const share = 1 / picked.length;
    const page = await pdf.getPage(n);
    const extracted = await extractPage(page, deps.OPS, n);
    let input = extracted.input;
    if (extracted.chars < SCAN_CHARS && extracted.paintedImages > 0) {
      scanned.push(n);
      const items = deps.readScan
        ? await deps.readScan(page, n, (r) => onProgress(base + share * (0.05 + 0.85 * r)))
        : null;
      if (items) input = { ...input, items, images: [] };
      else unreadable.push(n);
    }
    page.cleanup();
    inputs.push(input);
    numbers.push(n);
    onProgress(base + share * 0.95);
  }

  const built = pagesToWorkbook(inputs, numbers, options, title);
  const notes = [...built.notes];
  if (scanned.length && !unreadable.length) {
    notes.push(`${pagesPhrase(scanned)} had no text, so ${scanned.length === 1 ? "it was" : "they were"} read with OCR. Check the numbers.`);
  }
  if (unreadable.length) {
    notes.push(`${pagesPhrase(unreadable)} had no text and ${unreadable.length === 1 ? "was" : "were"} left empty.`);
  }
  return { bytes: await writeXlsx(built.book), notes, pages: picked.length, tables: built.tables };
}
