import { encodeJbig2Best } from "@/lib/jbig2";

import { detectDocument } from "./detect";
import { downscale } from "./geometry";
import { finalMaxSide, renderScanPage, type RenderSettings } from "./pipeline";
import type { Quad, RGBAImage } from "./types";

/** Browser-only pixel plumbing shared by the worker and the inline fallback. */

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

async function canvasBlob(c: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ("convertToBlob" in c) return c.convertToBlob({ type, quality });
  return new Promise((resolve, reject) =>
    (c as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Could not encode the page."))),
      type,
      quality,
    ),
  );
}

export async function decodeImage(file: Blob, maxSide = Infinity): Promise<RGBAImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * k));
    const h = Math.max(1, Math.round(bitmap.height * k));
    const canvas = makeCanvas(w, h);
    const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { data: data.data, width: w, height: h };
  } finally {
    bitmap.close();
  }
}

export async function encodeImage(img: RGBAImage, type: "image/jpeg" | "image/png", quality = 0.86) {
  const canvas = makeCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  const blob = await canvasBlob(canvas, type, quality);
  return new Uint8Array(await blob.arrayBuffer());
}

const cache = new Map<string, Promise<RGBAImage>>();
/** Decoded photos stay around while the person edits them; a few at most. */
function decoded(key: string, file: Blob, maxSide: number) {
  const id = `${key}:${maxSide}`;
  let hit = cache.get(id);
  if (!hit) {
    hit = decodeImage(file, maxSide);
    cache.set(id, hit);
    while (cache.size > 6) cache.delete(cache.keys().next().value as string);
    hit.catch(() => cache.delete(id));
  }
  return hit;
}

export function forget(key: string) {
  for (const k of [...cache.keys()]) if (k.startsWith(`${key}:`)) cache.delete(k);
}

const DETECT_SIDE = 900;

export async function opDetect(key: string, file: Blob): Promise<{ corners: Quad | null; width: number; height: number }> {
  const img = await decoded(key, file, DETECT_SIDE);
  const found = detectDocument(img);
  if (!found.found) return { corners: null, width: img.width, height: img.height };
  const corners = found.quad.map((p) => ({ x: p.x / img.width, y: p.y / img.height })) as Quad;
  return { corners, width: img.width, height: img.height };
}

export type PreviewSettings = Omit<RenderSettings, "maxSide">;

export async function opPreview(key: string, file: Blob, s: PreviewSettings, side = 700): Promise<RGBAImage> {
  const img = await decoded(key, file, Math.max(side * 2, 1200));
  const out = renderScanPage(downscale(img, Math.max(side * 2, 1200)), { ...s, maxSide: side }).rgba;
  return downscale(out, side);
}

export type FinalPage = {
  width: number;
  height: number;
  kind: "jbig2" | "jpeg";
  bytes: Uint8Array;
  /** Image for the OCR pass. */
  ocr?: { bytes: Uint8Array; type: string };
};

export async function opFinal(key: string, file: Blob, s: PreviewSettings, wantOcr: boolean): Promise<FinalPage> {
  const img = await decoded(key, file, 6000);
  const out = renderScanPage(img, { ...s, maxSide: finalMaxSide(s.filter) });
  const { width, height } = out.rgba;
  let page: FinalPage;
  if (out.ink) {
    page = { width, height, kind: "jbig2", bytes: encodeJbig2Best(out.ink, width, height, false) };
  } else {
    page = { width, height, kind: "jpeg", bytes: await encodeImage(out.rgba, "image/jpeg", 0.85) };
  }
  if (wantOcr) {
    const small = downscale(out.rgba, 2600);
    page.ocr = out.ink
      ? { bytes: await encodeImage(small, "image/png"), type: "image/png" }
      : { bytes: await encodeImage(small, "image/jpeg", 0.9), type: "image/jpeg" };
  }
  return page;
}
