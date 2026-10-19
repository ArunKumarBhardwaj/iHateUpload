import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFDict,
  PDFRef,
  PDFPage,
  concatTransformationMatrix,
  drawObject,
  popGraphicsState,
  pushGraphicsState,
} from "@cantoo/pdf-lib";

import type { ScanPageSize } from "./types";

export type ScanPdfPage = {
  /** Pixel size of the image. */
  width: number;
  height: number;
  kind: "jbig2" | "jpeg";
  bytes: Uint8Array;
  /** A one-page PDF from Tesseract; its invisible words are carried over. */
  textPdf?: Uint8Array | null;
};

const A4 = [595.28, 841.89] as const;
const LETTER = [612, 792] as const;
/** "Original" pages assume photos taken at this resolution. */
const ORIGINAL_DPI = 150;
/** Aspect ratios this close to the paper fill it edge to edge. */
const FILL_TOLERANCE = 0.06;

/** Where the image sits on a page of `size`. */
export function placeOnPage(
  width: number,
  height: number,
  size: ScanPageSize,
): { page: [number, number]; x: number; y: number; w: number; h: number } {
  if (size === "original") {
    const w = (width * 72) / ORIGINAL_DPI;
    const h = (height * 72) / ORIGINAL_DPI;
    return { page: [w, h], x: 0, y: 0, w, h };
  }
  let paper: readonly [number, number] = size === "a4" ? A4 : LETTER;
  // Sideways sheets get a sideways page.
  if (width > height) paper = [paper[1], paper[0]];
  const [pw, ph] = paper;
  const ratio = width / height / (pw / ph);
  if (Math.abs(ratio - 1) <= FILL_TOLERANCE) {
    return { page: [pw, ph], x: 0, y: 0, w: pw, h: ph };
  }
  const k = Math.min(pw / width, ph / height);
  const w = width * k;
  const h = height * k;
  return { page: [pw, ph], x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

/** A 1-bit JBIG2 or a JPEG image object in `doc`. */
async function imageRef(doc: PDFDocument, page: ScanPdfPage): Promise<PDFRef> {
  if (page.kind === "jpeg") {
    const image = await doc.embedJpg(page.bytes);
    await image.embed();
    return image.ref;
  }
  const dict = doc.context.obj({
    Type: "XObject",
    Subtype: "Image",
    Width: page.width,
    Height: page.height,
    ColorSpace: "DeviceGray",
    BitsPerComponent: 1,
    Filter: "JBIG2Decode",
    Length: page.bytes.length,
  }) as PDFDict;
  return doc.context.register(PDFRawStream.of(dict, page.bytes));
}

/** Points the first image of a Tesseract page at our image instead of its own. */
function swapImage(doc: PDFDocument, pdfPage: PDFPage, ref: PDFRef): boolean {
  const resources = pdfPage.node.Resources();
  const xobjects = resources?.lookupMaybe(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return false;
  for (const [key, value] of xobjects.entries()) {
    const obj = doc.context.lookup(value);
    if (
      obj instanceof PDFRawStream &&
      obj.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")
    ) {
      xobjects.set(key as PDFName, ref);
      return true;
    }
  }
  return false;
}

export async function buildScanPdf(
  pages: ScanPdfPage[],
  size: ScanPageSize,
  title = "Scan",
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("There are no pages to save.");
  const out = await PDFDocument.create();
  for (const p of pages) {
    const at = placeOnPage(p.width, p.height, size);
    const page = out.addPage(at.page);
    let done = false;
    if (p.textPdf) {
      try {
        const tess = await PDFDocument.load(p.textPdf, { ignoreEncryption: true });
        if (tess.getPageCount() > 0) {
          const tessPage = tess.getPage(0);
          if (swapImage(tess, tessPage, await imageRef(tess, p))) {
            const embedded = await out.embedPage(tessPage);
            page.drawPage(embedded, { x: at.x, y: at.y, width: at.w, height: at.h });
            done = true;
          }
        }
      } catch {
        done = false;
      }
    }
    if (!done) {
      const ref = await imageRef(out, p);
      const name = page.node.newXObject("Scan", ref);
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(at.w, 0, 0, at.h, at.x, at.y),
        drawObject(name),
        popGraphicsState(),
      );
    }
  }
  out.setTitle(title);
  out.setProducer("iHateUpload");
  out.setCreator("iHateUpload");
  return out.save({ useObjectStreams: true });
}
