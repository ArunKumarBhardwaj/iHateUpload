/**
 * PDF to PowerPoint: one slide per page.
 *  - editable: the exact-layout engine from PDF to Word, written as native text
 *    boxes, tables, pictures and shapes;
 *  - picture: each page as one image, for pages that must look identical.
 */
import type { PDFDocumentProxy } from "pdfjs-dist";

import { buildDocument, type ConvertDeps } from "@/lib/pdf-to-word";
import type { MediaFile } from "@/lib/pdf-to-word/model";

import { writePptx, type Slide, type SlideSize } from "./pptx-writer";

export type PptxMode = "editable" | "picture";

export type PptxConvertOptions = {
  mode: PptxMode;
  size: SlideSize;
  /** 1-based page numbers to convert, in order; all pages when missing. */
  pages?: number[];
};

export type PptxResult = { bytes: Uint8Array; notes: string[]; slides: number };

export async function convertPdfToPptx(
  pdf: PDFDocumentProxy,
  title: string,
  options: PptxConvertOptions,
  deps: ConvertDeps,
  onProgress: (ratio: number) => void,
): Promise<PptxResult> {
  const pages = options.pages?.length ? options.pages : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const notes: string[] = [];

  if (options.mode === "picture") {
    if (!deps.renderJpeg) throw new Error("Page images are not available here.");
    const media: Record<string, MediaFile> = {};
    const slides: Slide[] = [];
    for (let i = 0; i < pages.length; i++) {
      const page = await pdf.getPage(pages[i]);
      const { width, height } = page.getViewport({ scale: 1 });
      const ref = `page${pages[i]}`;
      media[ref] = { data: await deps.renderJpeg(page), mime: "image/jpeg" };
      page.cleanup();
      slides.push({ kind: "picture", ref, width, height });
      onProgress((i + 1) / pages.length);
    }
    return { bytes: await writePptx(slides, media, { size: options.size, title }), notes, slides: slides.length };
  }

  const built = await buildDocument(pdf, { mode: "exact", embedFonts: false }, deps, (r) => onProgress(r * 0.95), pages);
  const exact = built.model.pages ?? [];
  const slides: Slide[] = exact.map((page) => ({ kind: "exact", page }));
  const bytes = await writePptx(slides, built.media, { size: options.size, title, properties: built.model.properties });
  onProgress(1);
  return { bytes, notes: built.notes, slides: slides.length };
}
