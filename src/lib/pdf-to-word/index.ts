import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import { createResolver, readLinks, readOutline, readProperties } from "./annotations";
import { FontCollector } from "./embed";
import { writeDocx } from "./docx-writer";
import { extractPage, type ImageSource } from "./extract";
import { layoutDocument, type PageInput } from "./layout";
import type { DocModel, MediaFile } from "./model";

export type PdfToWordMode = "editable" | "exact";

export type ConvertOptions = {
  mode: PdfToWordMode;
  language: string;
  /** Carry the PDF's fonts in the Word file. On unless set to false. */
  embedFonts?: boolean;
};

/** The parts that need a browser. Tests swap them for stand-ins. */
export type ConvertDeps = {
  OPS: Record<string, number>;
  rasterizeImage: (page: PDFPageProxy, source: ImageSource) => Promise<MediaFile | null>;
  /** Read a page with no text layer. Returns text items in points, or null to skip. */
  readScan?: (page: PDFPageProxy, pageNo: number, onPage: (ratio: number) => void) => Promise<PageInput["items"] | null>;
  /** Exact mode: the page as a JPEG. */
  renderJpeg?: (page: PDFPageProxy) => Promise<Uint8Array>;
};

export type ConvertResult = { bytes: Uint8Array; notes: string[]; pages: number };

const SCAN_CHARS = 20;

function pagesPhrase(numbers: number[]): string {
  if (numbers.length === 1) return `Page ${numbers[0]}`;
  if (numbers.length <= 4) return `Pages ${numbers.join(", ")}`;
  return `Pages ${numbers.slice(0, 4).join(", ")} and ${numbers.length - 4} more`;
}

export async function convertPdf(
  pdf: PDFDocumentProxy,
  title: string,
  options: ConvertOptions,
  deps: ConvertDeps,
  onProgress: (ratio: number) => void,
): Promise<ConvertResult> {
  const total = pdf.numPages;
  const media: Record<string, MediaFile> = {};
  const notes: string[] = [];

  if (options.mode === "exact") {
    if (!deps.renderJpeg) throw new Error("Page images are not available here.");
    const model: DocModel = { sections: [], header: [], footer: [], notes: [] };
    for (let n = 1; n <= total; n++) {
      const page = await pdf.getPage(n);
      const { width: w, height: h } = page.getViewport({ scale: 1 });
      media[`page${n}`] = { data: await deps.renderJpeg(page), mime: "image/jpeg" };
      page.cleanup();
      model.sections.push({
        width: w,
        height: h,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        headerDistance: 0,
        footerDistance: 0,
        // Slightly under the page so Word never pushes the paragraph mark onto a new page.
        blocks: [{ type: "image", ref: `page${n}`, width: w, height: h - 2 }],
      });
      onProgress(n / total);
    }
    return { bytes: await writeDocx(model, media, title), notes, pages: total };
  }

  const resolve = createResolver(pdf);
  const fonts = options.embedFonts === false ? undefined : new FontCollector();
  const inputs: PageInput[] = [];
  const scanned: number[] = [];
  const unreadable: number[] = [];
  let rotatedSkipped = 0;
  let imageFailures = 0;
  for (let n = 1; n <= total; n++) {
    const base = (n - 1) / total;
    const share = 1 / total;
    const page = await pdf.getPage(n);
    const extracted = await extractPage(page, deps.OPS, n, fonts);
    rotatedSkipped += extracted.skippedRotated;
    let input = { ...extracted.input, links: await readLinks(page, resolve) };

    if (extracted.chars < SCAN_CHARS && extracted.paintedImages > 0) {
      scanned.push(n);
      const items = deps.readScan
        ? await deps.readScan(page, n, (r) => onProgress(base + share * 0.1 + share * 0.85 * r))
        : null;
      if (items) {
        input = { ...input, items, images: [] };
      } else {
        unreadable.push(n);
      }
    }

    for (const image of input.images) {
      const source = extracted.sources.get(image.ref);
      const file = source ? await deps.rasterizeImage(page, source) : null;
      if (file) media[image.ref] = file;
      else imageFailures++;
    }
    page.cleanup();
    inputs.push(input);
    onProgress(base + share * 0.95);
  }

  const model = layoutDocument(inputs, { outline: await readOutline(pdf, resolve) });
  model.properties = await readProperties(pdf);
  if (fonts) model.fonts = fonts.fonts();
  // A picture that could not be decoded would leave a hole, so drop its block.
  for (const section of model.sections) {
    section.blocks = section.blocks.filter((b) => b.type !== "image" || media[b.ref]);
  }
  if (scanned.length && !unreadable.length) {
    notes.push(`${pagesPhrase(scanned)} had no text, so ${scanned.length === 1 ? "it was" : "they were"} read with OCR. Check the words.`);
  }
  if (unreadable.length) {
    notes.push(`${pagesPhrase(unreadable)} had no text and ${unreadable.length === 1 ? "was" : "were"} left empty.`);
  }
  if (rotatedSkipped) notes.push("Some sideways text was left out.");
  if (imageFailures) notes.push(`${imageFailures} picture${imageFailures === 1 ? "" : "s"} could not be copied.`);
  return { bytes: await writeDocx(model, media, title), notes, pages: total };
}
