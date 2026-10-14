import type { PDFPageProxy } from "pdfjs-dist";

import type { ImageSource } from "./extract";
import type { MediaFile } from "./model";

const MAX_EDGE = 2000;

type PdfImage = {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
  bitmap?: ImageBitmap;
};

function loadObject(page: PDFPageProxy, id: string): Promise<PdfImage | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000);
    try {
      page.objs.get(id, (value: unknown) => {
        clearTimeout(timer);
        resolve((value as PdfImage) ?? null);
      });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function toImageData(img: PdfImage): ImageData | null {
  const { width, height, data } = img;
  if (!data || !width || !height) return null;
  const out = new Uint8ClampedArray(width * height * 4);
  if (img.kind === 3 || data.length >= width * height * 4) {
    out.set(data.subarray(0, out.length));
  } else if (img.kind === 2 || data.length >= width * height * 3) {
    for (let i = 0, j = 0; i < width * height; i++, j += 3) {
      out[i * 4] = data[j];
      out[i * 4 + 1] = data[j + 1];
      out[i * 4 + 2] = data[j + 2];
      out[i * 4 + 3] = 255;
    }
  } else {
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const on = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = on ? 255 : 0;
        const o = (y * width + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = v;
        out[o + 3] = 255;
      }
    }
  }
  return new ImageData(out, width, height);
}

/** Decode one picture from the page and re-encode it as PNG (if it has see-through parts) or JPEG. */
export async function rasterizeImage(
  page: PDFPageProxy,
  source: ImageSource,
): Promise<MediaFile | null> {
  const img =
    source.kind === "object" ? await loadObject(page, source.id) : (source.data as PdfImage);
  if (!img) return null;

  const full = document.createElement("canvas");
  const width = img.bitmap?.width ?? img.width;
  const height = img.bitmap?.height ?? img.height;
  if (!width || !height) return null;
  full.width = width;
  full.height = height;
  const fullCtx = full.getContext("2d");
  if (!fullCtx) return null;
  if (img.bitmap) {
    fullCtx.drawImage(img.bitmap, 0, 0);
  } else {
    const pixels = toImageData(img);
    if (!pixels) return null;
    fullCtx.putImageData(pixels, 0, 0);
  }

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(width * scale));
  out.height = Math.max(1, Math.round(height * scale));
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(full, 0, 0, out.width, out.height);

  const sample = ctx.getImageData(0, 0, out.width, out.height).data;
  let alpha = false;
  for (let i = 3; i < sample.length; i += 4) {
    if (sample[i] < 250) {
      alpha = true;
      break;
    }
  }
  const blob = alpha
    ? await canvasBlob(out, "image/png")
    : await canvasBlob(out, "image/jpeg", 0.9);
  full.width = full.height = out.width = out.height = 0;
  if (!blob) return null;
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    mime: alpha ? "image/png" : "image/jpeg",
  };
}

/** Draw a page on a white canvas. `scale` is pixels per point. */
export async function renderPageCanvas(
  page: PDFPageProxy,
  scale: number,
): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return canvas;
}

export async function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Uint8Array> {
  const blob = await canvasBlob(canvas, "image/jpeg", quality);
  if (!blob) throw new Error("Could not encode a page image.");
  return new Uint8Array(await blob.arrayBuffer());
}
