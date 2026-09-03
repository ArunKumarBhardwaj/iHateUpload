import type { PDFDocumentProxy } from "pdfjs-dist";

import { loadPdfJs } from "@/lib/pdfjs";

export type ThumbnailState =
  | { status: "pending" }
  | { status: "unavailable" }
  | { status: "ready"; url: string };

/** Caption facts a file card shows next to its thumbnail. */
export type FileFacts =
  | { kind: "pdf"; pages: number }
  | { kind: "image"; width: number; height: number };

export type FilePreview = {
  thumbnail: ThumbnailState;
  /** Null when the file could not be inspected at all. */
  facts: FileFacts | null;
};

export const PENDING_THUMBNAIL: ThumbnailState = { status: "pending" };
export const UNAVAILABLE_THUMBNAIL: ThumbnailState = { status: "unavailable" };

export const PENDING_PREVIEW: FilePreview = {
  thumbnail: PENDING_THUMBNAIL,
  facts: null,
};

export const UNAVAILABLE_PREVIEW: FilePreview = {
  thumbnail: { status: "unavailable" },
  facts: null,
};

/** Longest edge of a rendered thumbnail, in device pixels. */
const THUMBNAIL_EDGE = 480;

export function revokeThumbnail(thumbnail: ThumbnailState) {
  if (thumbnail.status === "ready") URL.revokeObjectURL(thumbnail.url);
}

function thumbnailBox(width: number, height: number) {
  const scale = Math.min(THUMBNAIL_EDGE / Math.max(width, height), 3);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Paints white first so transparent PNGs and PDF pages read as paper. */
function paperCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

async function canvasToThumbnailUrl(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", 0.82);
  });
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("Could not encode the thumbnail.");
  return URL.createObjectURL(blob);
}

function decodeImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("This browser cannot decode the image."));
    image.src = url;
  });
}

/**
 * Decoding goes through an `<img>` rather than `createImageBitmap` so Safari's
 * native HEIC support produces a real preview on iPhones, where a third of our
 * traffic comes from. Browsers without it land on the unavailable state.
 */
export async function imagePreview(file: Blob): Promise<FilePreview> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await decodeImage(sourceUrl);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const box = thumbnailBox(width, height);
    const { canvas, ctx } = paperCanvas(box.width, box.height);
    ctx.drawImage(image, 0, 0, box.width, box.height);
    return {
      thumbnail: { status: "ready", url: await canvasToThumbnailUrl(canvas) },
      facts: { kind: "image", width, height },
    };
  } catch {
    return UNAVAILABLE_PREVIEW;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function pageThumbnail(
  doc: PDFDocumentProxy,
  pageNumber: number,
): Promise<ThumbnailState> {
  const page = await doc.getPage(pageNumber);
  try {
    const unscaled = page.getViewport({ scale: 1 });
    const box = thumbnailBox(unscaled.width, unscaled.height);
    const viewport = page.getViewport({ scale: box.width / unscaled.width });
    const { canvas, ctx } = paperCanvas(
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height)),
    );
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return { status: "ready", url: await canvasToThumbnailUrl(canvas) };
  } finally {
    page.cleanup();
  }
}

/** First page plus page count. Encrypted PDFs yield no preview at all. */
export async function pdfPreview(file: Blob): Promise<FilePreview> {
  const { getDocument } = await loadPdfJs();
  let doc: PDFDocumentProxy;
  try {
    doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
      .promise;
  } catch {
    return UNAVAILABLE_PREVIEW;
  }
  const facts: FileFacts = { kind: "pdf", pages: doc.numPages };
  try {
    return { thumbnail: await pageThumbnail(doc, 1), facts };
  } catch {
    return { thumbnail: { status: "unavailable" }, facts };
  } finally {
    await doc.loadingTask.destroy();
  }
}

/**
 * Renders the given 1-based pages one at a time, handing each thumbnail over as
 * it lands so a long document fills in progressively. A thumbnail that finishes
 * after `cancelled()` turns true is revoked here rather than handed out.
 */
export async function renderPdfPages(
  file: Blob,
  pageNumbers: number[],
  onPage: (pageNumber: number, thumbnail: ThumbnailState) => void,
  cancelled: () => boolean,
): Promise<void> {
  const { getDocument } = await loadPdfJs();
  const doc = await getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  }).promise;
  try {
    for (const pageNumber of pageNumbers) {
      if (cancelled()) return;
      let thumbnail: ThumbnailState;
      try {
        thumbnail = await pageThumbnail(doc, pageNumber);
      } catch {
        thumbnail = { status: "unavailable" };
      }
      if (cancelled()) {
        revokeThumbnail(thumbnail);
        return;
      }
      onPage(pageNumber, thumbnail);
    }
  } finally {
    await doc.loadingTask.destroy();
  }
}
