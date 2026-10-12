import imageCompression from "browser-image-compression";
import { PDFDocument, degrees, toDegrees } from "@cantoo/pdf-lib";
import type { PDFPageProxy } from "pdfjs-dist";

import { compressInWorker } from "@/lib/compress-client";
import { COMPRESS_PLANS } from "@/lib/compress-plans";
import type { FileItem, ResultItem } from "@/lib/job";
import { stripPdfMetadata } from "@/lib/pdf-meta";
import { loadPdfJs } from "@/lib/pdfjs";
import {
  parsePageRange,
  type ToolOptions,
} from "@/lib/tool-options";
import { formatBytes } from "@/lib/utils";

type ProgressFn = (ratio: number) => void;

/**
 * iOS ≤ 17 caps a single canvas at 4096×4096 / 16.7 M pixels. Crossing it
 * paints a blank canvas and does not throw. Stay under that on every engine
 * rather than sniff the OS. iOS 18 raised the cap; we still target the lower
 * one because 28% of visitors are on iOS and we cannot see the version.
 */
const CANVAS_MAX_EDGE = 4096;
const CANVAS_MAX_PIXELS = 16_777_216;

const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heif",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

function replaceExt(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  canvas.width = 0;
  canvas.height = 0;
}

function clampCanvasSize(width: number, height: number) {
  const longest = Math.max(width, height, 1);
  const pixels = Math.max(width * height, 1);
  const scale = Math.min(
    1,
    CANVAS_MAX_EDGE / longest,
    Math.sqrt(CANVAS_MAX_PIXELS / pixels),
  );
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
    scale,
  };
}

async function loadHeic2Any() {
  const mod = await import("heic2any");
  return mod.default;
}

async function sniffImageKind(
  file: Blob,
): Promise<"jpeg" | "png" | "heic" | "unknown"> {
  const buf = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "jpeg";
  }
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "png";
  }
  if (buf.length >= 12) {
    const box = String.fromCharCode(buf[4], buf[5], buf[6], buf[7]);
    const brand = String.fromCharCode(buf[8], buf[9], buf[10], buf[11]);
    if (box === "ftyp" && HEIC_BRANDS.has(brand)) return "heic";
  }
  return "unknown";
}

async function encodeCanvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
  if (!blob) throw new Error(`Could not encode ${type}.`);
  return blob;
}

async function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  try {
    return await encodeCanvasBlob(canvas, "image/jpeg", quality);
  } finally {
    releaseCanvas(canvas);
  }
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  try {
    return await encodeCanvasBlob(canvas, "image/png");
  } finally {
    releaseCanvas(canvas);
  }
}

async function canvasToWebpBlob(
  canvas: HTMLCanvasElement,
  quality = 0.86,
): Promise<Blob> {
  try {
    const blob = await encodeCanvasBlob(canvas, "image/webp", quality);
    if (blob.type !== "image/webp") {
      throw new Error("This browser cannot write WebP.");
    }
    return blob;
  } finally {
    releaseCanvas(canvas);
  }
}

function imageOutKind(file: File): "jpeg" | "png" | "webp" {
  const name = file.name.toLowerCase();
  if (file.type === "image/png" || name.endsWith(".png")) return "png";
  if (file.type === "image/webp" || name.endsWith(".webp")) return "webp";
  return "jpeg";
}

async function canvasToKindBlob(
  canvas: HTMLCanvasElement,
  kind: "jpeg" | "png" | "webp",
): Promise<Blob> {
  if (kind === "png") return canvasToPngBlob(canvas);
  if (kind === "webp") return canvasToWebpBlob(canvas);
  return canvasToJpegBlob(canvas, 0.92);
}

function extForKind(kind: "jpeg" | "png" | "webp"): string {
  if (kind === "png") return "png";
  if (kind === "webp") return "webp";
  return "jpg";
}

async function bestJpegUnder(
  canvas: HTMLCanvasElement,
  maxBytes: number,
): Promise<Blob | null> {
  let low = 0.12;
  let high = 0.92;
  let best: Blob | null = null;
  for (let i = 0; i < 8; i++) {
    const quality = (low + high) / 2;
    const blob = await encodeCanvasBlob(canvas, "image/jpeg", quality);
    if (blob.size <= maxBytes) {
      best = blob;
      low = quality;
    } else {
      high = quality;
    }
  }
  return best;
}

async function drawFileToCanvas(
  file: File,
  options?: { maxEdge?: number; fillWhite?: boolean },
): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  let width = bitmap.width;
  let height = bitmap.height;
  const maxEdge = options?.maxEdge;
  if (maxEdge && maxEdge > 0) {
    const longest = Math.max(width, height);
    if (longest > maxEdge) {
      const scale = maxEdge / longest;
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
    }
  }

  const box = clampCanvasSize(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    releaseCanvas(canvas);
    throw new Error("Canvas is not available in this browser.");
  }
  if (options?.fillWhite) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, box.width, box.height);
  }
  ctx.drawImage(bitmap, 0, 0, box.width, box.height);
  bitmap.close();
  return canvas;
}

async function imageFileToJpegBlob(file: File, quality = 0.92): Promise<Blob> {
  const canvas = await drawFileToCanvas(file, { fillWhite: true });
  return canvasToJpegBlob(canvas, quality);
}

async function imageFileToPngBlob(file: File): Promise<Blob> {
  const canvas = await drawFileToCanvas(file);
  return canvasToPngBlob(canvas);
}

/**
 * iOS Safari often transcodes a Photo Library HEIC to JPEG before onChange
 * fires, and names the result something like tempImage1234.jpg. heic2any then
 * throws. Sniff the bytes and pass a JPEG through instead of decoding it twice.
 */
async function heicFileToJpegBlob(file: File, quality = 0.92): Promise<Blob> {
  const kind = await sniffImageKind(file);
  if (kind === "jpeg") return file;
  const heic2any = await loadHeic2Any();
  try {
    const converted = await heic2any({
      blob: file,
      toType: "image/jpeg",
      quality,
    });
    return Array.isArray(converted) ? converted[0] : converted;
  } catch (error) {
    if (kind === "heic") throw error;
    return imageFileToJpegBlob(file, quality);
  }
}

async function renderPdfPageToJpeg(
  page: PDFPageProxy,
  scale: number,
  quality: number,
): Promise<Blob> {
  const preferred = page.getViewport({ scale });
  const box = clampCanvasSize(preferred.width, preferred.height);
  const viewport = page.getViewport({
    scale: scale * (box.width / Math.max(preferred.width, 1)),
  });
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    releaseCanvas(canvas);
    throw new Error("Canvas is not available in this browser.");
  }
  try {
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return await canvasToJpegBlob(canvas, quality);
  } finally {
    page.cleanup();
  }
}

async function embedImageInPdf(
  pdf: PDFDocument,
  bytes: Uint8Array,
  file: File,
) {
  const name = file.name.toLowerCase();
  const isPng = file.type === "image/png" || name.endsWith(".png");
  const isWebp = file.type === "image/webp" || name.endsWith(".webp");

  if (isWebp) {
    const jpeg = await imageFileToJpegBlob(file);
    const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
    return pdf.embedJpg(jpegBytes);
  }

  return isPng ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
}

export async function processHeicToJpg(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const blob = await heicFileToJpegBlob(item.file, 0.92);
    results.push({
      id: item.id,
      name: replaceExt(item.name, "jpg"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processHeicToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const pdf = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const jpeg = await heicFileToJpegBlob(item.file, 0.92);
    const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
    const image = await pdf.embedJpg(jpegBytes);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
    onProgress((i + 1) / (files.length + 1));
  }

  const pdfBytes = await pdf.save();
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  onProgress(1);

  return [
    {
      id: crypto.randomUUID(),
      name: files.length === 1 ? replaceExt(files[0].name, "pdf") : "heic.pdf",
      size: blob.size,
      blob,
      originalSize: files.reduce((sum, f) => sum + f.size, 0),
    },
  ];
}

export async function processCompressImage(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const compressed = await imageCompression(item.file, {
      maxSizeMB: 1,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      initialQuality: 0.8,
    });
    const output = compressed.size < item.size ? compressed : item.file;
    const ext = output.type.includes("png")
      ? "png"
      : output.type.includes("webp")
        ? "webp"
        : "jpg";
    results.push({
      id: item.id,
      name: replaceExt(item.name, ext),
      size: output.size,
      blob: output,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processWebpToJpg(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const blob = await imageFileToJpegBlob(item.file, 0.92);
    results.push({
      id: item.id,
      name: replaceExt(item.name, "jpg"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processPngToJpg(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const blob = await imageFileToJpegBlob(item.file, 0.92);
    results.push({
      id: item.id,
      name: replaceExt(item.name, "jpg"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processJpgToPng(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const blob = await imageFileToPngBlob(item.file);
    results.push({
      id: item.id,
      name: replaceExt(item.name, "png"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processJpgToWebp(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const kind = imageOutKind(item.file);
    const canvas = await drawFileToCanvas(item.file, {
      fillWhite: kind !== "png",
    });
    const blob = await canvasToWebpBlob(canvas);
    results.push({
      id: item.id,
      name: replaceExt(item.name, "webp"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processCropImage(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "image-crop") {
    throw new Error("Crop Image needs a crop box.");
  }
  const item = files[0];
  if (!item) throw new Error("Add a photo to crop.");
  if (options.box.w <= 0.04 || options.box.h <= 0.04) {
    throw new Error("Draw a larger crop box.");
  }

  const source = await drawFileToCanvas(item.file);
  const cropped = document.createElement("canvas");
  try {
    const sx = Math.round(options.box.x * source.width);
    const sy = Math.round(options.box.y * source.height);
    const sw = Math.max(1, Math.round(options.box.w * source.width));
    const sh = Math.max(1, Math.round(options.box.h * source.height));
    cropped.width = sw;
    cropped.height = sh;
    const ctx = cropped.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  } catch (error) {
    releaseCanvas(cropped);
    throw error;
  } finally {
    releaseCanvas(source);
  }

  const kind = imageOutKind(item.file);
  const blob = await canvasToKindBlob(cropped, kind);
  onProgress(1);
  return [
    {
      id: item.id,
      name: `${item.name.replace(/\.[^.]+$/, "")}-cropped.${extForKind(kind)}`,
      size: blob.size,
      blob,
      originalSize: item.size,
    },
  ];
}

export async function processRotateImage(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "image-turn") {
    throw new Error("Rotate Image needs a turn.");
  }
  const { degrees: turn, flipH, flipV } = options;
  if (turn === 0 && !flipH && !flipV) {
    throw new Error("Pick a turn or a flip.");
  }

  const results: ResultItem[] = [];
  const rad = (turn * Math.PI) / 180;
  const swap = turn === 90 || turn === 270;

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const source = await drawFileToCanvas(item.file);
    const out = document.createElement("canvas");
    try {
      out.width = swap ? source.height : source.width;
      out.height = swap ? source.width : source.height;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.translate(out.width / 2, out.height / 2);
      ctx.rotate(rad);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.drawImage(source, -source.width / 2, -source.height / 2);
    } catch (error) {
      releaseCanvas(out);
      throw error;
    } finally {
      releaseCanvas(source);
    }

    const kind = imageOutKind(item.file);
    const blob = await canvasToKindBlob(out, kind);
    results.push({
      id: item.id,
      name: `${item.name.replace(/\.[^.]+$/, "")}-rotated.${extForKind(kind)}`,
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processCompressToSize(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "target-kb") {
    throw new Error("Compress to Size needs a KB target.");
  }
  const maxBytes = Math.floor(options.maxKb * 1024);
  if (!Number.isFinite(maxBytes) || maxBytes < 20 * 1024) {
    throw new Error("Pick a target of at least 20 KB.");
  }

  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const alreadyJpeg =
      item.file.type === "image/jpeg" ||
      item.name.toLowerCase().endsWith(".jpg") ||
      item.name.toLowerCase().endsWith(".jpeg");
    let blob: Blob | null = null;
    let name = `${item.name.replace(/\.[^.]+$/, "")}-${options.maxKb}kb.jpg`;
    if (alreadyJpeg && item.size <= maxBytes) {
      blob = item.file;
      name = replaceExt(item.name, "jpg");
    } else {
      const bitmap = await createImageBitmap(item.file);
      let maxEdge = Math.max(bitmap.width, bitmap.height);
      bitmap.close();

      while (maxEdge >= 32) {
        const canvas = await drawFileToCanvas(item.file, {
          maxEdge,
          fillWhite: true,
        });
        try {
          blob = await bestJpegUnder(canvas, maxBytes);
        } finally {
          releaseCanvas(canvas);
        }
        if (blob) break;
        const next = Math.floor(maxEdge * 0.72);
        if (next >= maxEdge) break;
        maxEdge = next;
      }
    }

    if (!blob || blob.size > maxBytes) {
      throw new Error(
        `Could not get ${item.name} under ${options.maxKb} KB.`,
      );
    }

    results.push({
      id: item.id,
      name,
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processResizeImage(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "resize") {
    throw new Error("Resize Image requires a max edge size.");
  }
  const maxEdge = options.maxEdge;
  if (!Number.isFinite(maxEdge) || maxEdge < 16 || maxEdge > 10000) {
    throw new Error("Choose a max edge between 16 and 10000 pixels.");
  }

  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const name = item.name.toLowerCase();
    const isPng = item.file.type === "image/png" || name.endsWith(".png");
    const canvas = await drawFileToCanvas(item.file, {
      maxEdge,
      fillWhite: !isPng,
    });
    const blob = isPng
      ? await canvasToPngBlob(canvas)
      : await canvasToJpegBlob(canvas, 0.9);
    const ext = isPng ? "png" : "jpg";
    const base = item.name.replace(/\.[^.]+$/, "");
    results.push({
      id: item.id,
      name: `${base}-resized.${ext}`,
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processImageToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const pdf = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const image = await embedImageInPdf(pdf, bytes, item.file);
    const page = pdf.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
    onProgress((i + 1) / (files.length + 1));
  }

  const pdfBytes = await pdf.save();
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  onProgress(1);

  return [
    {
      id: crypto.randomUUID(),
      name: files.length === 1 ? replaceExt(files[0].name, "pdf") : "images.pdf",
      size: blob.size,
      blob,
      originalSize: files.reduce((sum, f) => sum + f.size, 0),
    },
  ];
}

export async function processMergePdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  if (files.length < 2) {
    throw new Error("Add at least two PDF files to merge.");
  }

  const merged = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const bytes = await item.file.arrayBuffer();
    const donor = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(donor, donor.getPageIndices());
    for (const page of pages) merged.addPage(page);
    onProgress((i + 1) / (files.length + 1));
  }

  const pdfBytes = await merged.save({ useObjectStreams: true });
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  onProgress(1);

  return [
    {
      id: crypto.randomUUID(),
      name: "merged.pdf",
      size: blob.size,
      blob,
      originalSize: files.reduce((sum, f) => sum + f.size, 0),
    },
  ];
}

export async function processSplitPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to split.");

  const donor = await PDFDocument.load(await item.file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const indices = donor.getPageIndices();
  if (indices.length === 0) throw new Error("This PDF has no pages.");

  const base = item.name.replace(/\.[^.]+$/, "");
  const results: ResultItem[] = [];

  for (let i = 0; i < indices.length; i++) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(donor, [indices[i]]);
    out.addPage(page);
    const pdfBytes = await out.save({ useObjectStreams: true });
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    results.push({
      id: crypto.randomUUID(),
      name: `${base}-page-${i + 1}.pdf`,
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / indices.length);
  }

  return results;
}

export async function processPdfToJpg(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to convert.");

  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const base = item.name.replace(/\.[^.]+$/, "");
  const results: ResultItem[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const blob = await renderPdfPageToJpeg(page, 2, 0.9);
      results.push({
        id: crypto.randomUUID(),
        name: `${base}-page-${pageNum}.jpg`,
        size: blob.size,
        blob,
        originalSize: item.size,
      });
      onProgress(pageNum / pdf.numPages);
    }
  } finally {
    await pdf.loadingTask.destroy();
  }

  return results;
}

export async function processPdfToPng(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to convert.");

  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const base = item.name.replace(/\.[^.]+$/, "");
  const results: ResultItem[] = [];

  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const blob = await renderPdfPageToPng(page, 2);
      results.push({
        id: crypto.randomUUID(),
        name: `${base}-page-${pageNum}.png`,
        size: blob.size,
        blob,
        originalSize: item.size,
      });
      onProgress(pageNum / pdf.numPages);
    }
  } finally {
    await pdf.loadingTask.destroy();
  }

  return results;
}

async function renderPdfPageToPng(
  page: PDFPageProxy,
  scale: number,
): Promise<Blob> {
  const preferred = page.getViewport({ scale });
  const box = clampCanvasSize(preferred.width, preferred.height);
  const viewport = page.getViewport({
    scale: scale * (box.width / Math.max(preferred.width, 1)),
  });
  const canvas = document.createElement("canvas");
  canvas.width = box.width;
  canvas.height = box.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    releaseCanvas(canvas);
    throw new Error("Canvas is not available in this browser.");
  }
  try {
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return await canvasToPngBlob(canvas);
  } finally {
    page.cleanup();
  }
}

/** Smallest only: flattening pages has to beat the kept-text result by this much. */
const RASTER_MUST_BEAT = 0.6;
const HEAVY_RASTER = { scale: 0.95, quality: 0.44 };

export function pdfBlob(bytes: Uint8Array) {
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

export { stripPdfMetadata };

async function rasterizePdf(bytes: Uint8Array): Promise<Blob> {
  const { getDocument } = await loadPdfJs();
  const src = await getDocument({ data: bytes.slice() }).promise;
  const out = await PDFDocument.create();
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const jpeg = await renderPdfPageToJpeg(
        page,
        HEAVY_RASTER.scale,
        HEAVY_RASTER.quality,
      );
      const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
      const pdfPage = out.addPage([image.width, image.height]);
      pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    }
  } finally {
    await src.loadingTask.destroy();
  }
  stripPdfMetadata(out);
  return pdfBlob(await out.save({ useObjectStreams: true }));
}

/**
 * Every level keeps the page: text stays selectable and links and forms
 * survive. Images are resampled to the level's dpi at the size the page
 * draws them, in a worker. Smallest may still flatten pages to JPEG, but
 * only when that is far smaller.
 */
export async function processCompressPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "compress") {
    throw new Error("Compress PDF requires a compression level.");
  }

  const targetBytes = options.targetKb ? options.targetKb * 1024 : undefined;
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const share = options.level === "heavy" && !targetBytes ? 0.8 : 1;
    const { bytes: kept, fit } = await compressInWorker(
      bytes,
      COMPRESS_PLANS[options.level],
      (f) => onProgress((i + f * share) / files.length),
      targetBytes,
    );
    let best: Blob = pdfBlob(kept);

    if (options.level === "heavy" && !targetBytes) {
      const raster = await rasterizePdf(bytes);
      if (raster.size < best.size * RASTER_MUST_BEAT) best = raster;
    }
    if (best.size >= item.size) best = item.file;

    results.push({
      id: item.id,
      name: replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-compressed.pdf"),
      size: best.size,
      blob: best,
      originalSize: item.size,
      note:
        targetBytes && !fit
          ? `Could not reach ${formatBytes(targetBytes)} without wrecking the images. This is the smallest readable version.`
          : undefined,
    });
  }

  onProgress(1);
  return results;
}

export async function processExtractPages(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "extract") {
    throw new Error("Extract Pages requires a page range.");
  }
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to extract pages from.");

  const donor = await PDFDocument.load(await item.file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const indices = parsePageRange(options.range, donor.getPageCount());
  if (indices.length === 0) {
    throw new Error("Enter pages to keep, like 1-3, 7.");
  }

  const out = await PDFDocument.create();
  const copied = await out.copyPages(donor, indices);
  for (const page of copied) out.addPage(page);
  onProgress(0.8);
  const blob = pdfBlob(await out.save({ useObjectStreams: true }));
  onProgress(1);

  return [
    {
      id: crypto.randomUUID(),
      name: replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-extracted.pdf"),
      size: blob.size,
      blob,
      originalSize: item.size,
    },
  ];
}

export async function getPdfPageCount(file: File): Promise<number> {
  const doc = await PDFDocument.load(await file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  return doc.getPageCount();
}

function requirePassword(options: ToolOptions, label: string): string {
  if (options.kind !== "password" && options.kind !== "password-confirm") {
    throw new Error(`${label} requires a password.`);
  }
  const password = options.password.trim();
  if (!password) throw new Error("Enter a password.");
  return password;
}

export async function processProtectPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  const password = requirePassword(options, "Protect PDF");
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await PDFDocument.load(await item.file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    doc.encrypt({
      userPassword: password,
      ownerPassword: password,
    });
    const pdfBytes = await doc.save();
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    results.push({
      id: item.id,
      name: replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-protected.pdf"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processUnlockPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  const password = requirePassword(options, "Unlock PDF");
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(await item.file.arrayBuffer(), {
        password,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/password/i.test(message) || /encrypt/i.test(message)) {
        throw new Error(
          `Wrong password for "${item.name}". Check it and try again.`,
        );
      }
      throw error instanceof Error
        ? error
        : new Error(`Could not unlock "${item.name}".`);
    }
    const pdfBytes = await doc.save({ useObjectStreams: true });
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    results.push({
      id: item.id,
      name: replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-unlocked.pdf"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processRotatePdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "rotate") {
    throw new Error("Rotate PDF requires a rotation angle.");
  }
  const delta = options.degrees;
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await PDFDocument.load(await item.file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    for (const page of doc.getPages()) {
      const current = toDegrees(page.getRotation());
      page.setRotation(degrees((current + delta) % 360));
    }
    const pdfBytes = await doc.save({ useObjectStreams: true });
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    results.push({
      id: item.id,
      name: replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-rotated.pdf"),
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress((i + 1) / files.length);
  }

  return results;
}

export async function processOrganizePdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "organize") {
    throw new Error("Organize PDF requires a page order.");
  }
  if (options.pageOrder.length < 1) {
    throw new Error("Keep at least one page.");
  }

  const item = files[0];
  if (!item) throw new Error("Choose a PDF to organize.");

  const donor = await PDFDocument.load(await item.file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const pageCount = donor.getPageCount();
  for (const index of options.pageOrder) {
    if (index < 0 || index >= pageCount) {
      throw new Error("Page order includes an invalid page.");
    }
  }

  onProgress(0.2);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(donor, options.pageOrder);
  for (const page of copied) out.addPage(page);
  onProgress(0.8);

  const pdfBytes = await out.save({ useObjectStreams: true });
  const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
    type: "application/pdf",
  });
  onProgress(1);

  return [
    {
      id: crypto.randomUUID(),
      name: replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-organized.pdf"),
      size: blob.size,
      blob,
      originalSize: item.size,
    },
  ];
}
