import { encryptionFor } from "@/lib/protect";
import { unlockPdfBytes, WrongPasswordError } from "@/lib/unlock";
import imageCompression from "browser-image-compression";
import { PDFDocument, degrees, toDegrees } from "@cantoo/pdf-lib";
import type { PDFPageProxy } from "pdfjs-dist";

import { compressInWorker } from "@/lib/compress-client";
import { COMPRESS_PLANS } from "@/lib/compress-plans";
import type { FileItem, ResultItem } from "@/lib/job";
import { flipPage } from "@/lib/page-ops";
import { stripPdfMetadata } from "@/lib/pdf-meta";
import {
  canvasHoldsSize,
  clampCanvasSize,
  currentCanvasLimits,
  jpegQualityValue,
  SAFE_CANVAS,
  pageRenderNote,
  planPageRender,
} from "@/lib/pdf-image";
import { loadPdfJs } from "@/lib/pdfjs";
import {
  partNote,
  planByBookmarks,
  planByText,
  readOutline,
  readPageTexts,
  type SplitPart,
} from "@/lib/split-plan";
import {
  parsePageRange,
  parseRangeGroups,
  resolvePageRange,
  type ToolOptions,
} from "@/lib/tool-options";
import { formatBytes } from "@/lib/utils";

type ProgressFn = (ratio: number) => void;

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

function uniqueNames(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    return n === 0 ? name : name.replace(/\.pdf$/i, ` (${n + 1}).pdf`);
  });
}

/** Copies the listed pages of `donor` into a fresh document and saves it. */
async function savePageSubset(donor: PDFDocument, indices: number[]) {
  const out = await PDFDocument.create();
  const pages = await out.copyPages(donor, indices);
  for (const page of pages) out.addPage(page);
  return out.save({ useObjectStreams: true });
}

/**
 * Greedy parts under `limit` bytes. Each part grows one page at a time and is
 * measured as saved; a page that overflows starts the next part. A page that
 * is over the limit on its own still ships, alone, and is reported.
 */
async function splitBySize(
  donor: PDFDocument,
  limit: number,
  onProgress: ProgressFn,
) {
  const count = donor.getPageCount();
  const parts: { indices: number[]; bytes: Uint8Array; oversize: boolean }[] = [];
  let indices: number[] = [];
  let kept: Uint8Array | null = null;

  for (let i = 0; i < count; i++) {
    const trial = await savePageSubset(donor, [...indices, i]);
    if (trial.length <= limit || indices.length === 0) {
      indices = [...indices, i];
      kept = trial;
    } else {
      parts.push({ indices, bytes: kept!, oversize: false });
      indices = [i];
      kept = await savePageSubset(donor, indices);
    }
    onProgress((i + 1) / count / 2);
  }
  if (kept) parts.push({ indices, bytes: kept, oversize: false });
  for (const part of parts) {
    part.oversize = part.indices.length === 1 && part.bytes.length > limit;
  }
  return parts;
}

export async function processSplitPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "split") throw new Error("Split PDF needs a split mode.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to split.");

  const donor = await PDFDocument.load(await item.file.arrayBuffer(), {
    ignoreEncryption: true,
  });
  const count = donor.getPageCount();
  if (count === 0) throw new Error("This PDF has no pages.");

  const base = item.name.replace(/\.[^.]+$/, "");
  const results: ResultItem[] = [];
  const push = (bytes: Uint8Array, name: string, note?: string) => {
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    results.push({
      id: crypto.randomUUID(),
      name,
      size: blob.size,
      blob,
      originalSize: item.size,
      note,
    });
  };

  if (options.mode === "bookmarks" || options.mode === "text") {
    const data = new Uint8Array(await item.file.arrayBuffer());
    let parts: SplitPart[];
    if (options.mode === "bookmarks") {
      const outline = await readOutline(data);
      if (outline.length === 0) {
        throw new Error("This PDF has no bookmarks to split on.");
      }
      parts = planByBookmarks(
        outline,
        count,
        options.bookmarkDepth,
        base,
        options.bookmarkOff,
      );
    } else {
      const plan = planByText(await readPageTexts(data), options, base);
      if (!plan.ok) throw new Error(plan.error);
      parts = plan.parts;
    }
    const names = uniqueNames(parts.map((part) => `${part.name}.pdf`));
    for (let i = 0; i < parts.length; i++) {
      const { start, end } = parts[i];
      const indices = Array.from({ length: end - start + 1 }, (_, k) => start + k);
      push(await savePageSubset(donor, indices), names[i], partNote(parts[i]));
      onProgress((i + 1) / parts.length);
    }
    return results;
  }

  if (options.mode === "size") {
    const limit = options.maxMb * 1_000_000;
    if (!(limit > 0)) throw new Error("Enter a size limit in MB.");
    const parts = await splitBySize(donor, limit, onProgress);
    parts.forEach((part, index) => {
      const first = part.indices[0] + 1;
      const last = part.indices[part.indices.length - 1] + 1;
      push(
        part.bytes,
        `${base}-part-${index + 1}.pdf`,
        part.oversize
          ? `Page ${first} alone is ${formatBytes(part.bytes.length)}, over the ${options.maxMb} MB limit.`
          : parts.length > 1
            ? first === last
              ? `Page ${first}`
              : `Pages ${first}-${last}`
            : undefined,
      );
    });
    onProgress(1);
    return results;
  }

  let groups: number[][];
  let names: string[];
  if (options.mode === "ranges") {
    groups = parseRangeGroups(options.ranges, count);
    if (groups.length === 0) {
      throw new Error("Enter ranges like 1-3, 4-6, 7-.");
    }
    names = groups.map(
      (group) =>
        `${base}-pages-${group[0] + 1}${group.length > 1 ? `-${group[group.length - 1] + 1}` : ""}.pdf`,
    );
  } else if (options.mode === "half") {
    if (count < 2) throw new Error("Splitting in half needs at least 2 pages.");
    const mid = Math.ceil(count / 2);
    const all = donor.getPageIndices();
    groups = [all.slice(0, mid), all.slice(mid)];
    names = [`${base}-part-1.pdf`, `${base}-part-2.pdf`];
  } else {
    groups = donor.getPageIndices().map((index) => [index]);
    names = groups.map((_, index) => `${base}-page-${index + 1}.pdf`);
  }

  for (let i = 0; i < groups.length; i++) {
    push(await savePageSubset(donor, groups[i]), names[i]);
    onProgress((i + 1) / groups.length);
  }

  return results;
}

/** pdf.js renders at 72 DPI for scale 1. */
export function dpiScale(dpi: number) {
  return dpi / 72;
}

async function renderPdfPage(
  page: PDFPageProxy,
  plan: { width: number; height: number; scale: number },
  encode: (canvas: HTMLCanvasElement) => Promise<Blob>,
): Promise<Blob> {
  const viewport = page.getViewport({ scale: plan.scale });
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    releaseCanvas(canvas);
    throw new Error("Canvas is not available in this browser.");
  }
  try {
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return await encode(canvas);
  } finally {
    page.cleanup();
  }
}

async function renderPdfPageToJpeg(
  page: PDFPageProxy,
  scale: number,
  quality: number,
): Promise<Blob> {
  const size = page.getViewport({ scale });
  const box = clampCanvasSize(size.width, size.height);
  return renderPdfPage(
    page,
    { ...box, scale: scale * (box.width / Math.max(size.width, 1)) },
    (canvas) => canvasToJpegBlob(canvas, quality),
  );
}

async function processPdfToImages(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "pdf-image") {
    throw new Error("PDF to image needs a resolution.");
  }
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to convert.");

  const png = options.format === "png";
  const quality = jpegQualityValue(options.quality);
  const limits = currentCanvasLimits();
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const pdf = await getDocument({ data }).promise;
  const base = item.name.replace(/\.[^.]+$/, "");
  const results: ResultItem[] = [];

  try {
    const wanted = resolvePageRange(options.range, pdf.numPages);
    for (let done = 0; done < wanted.length; done++) {
      const pageNum = wanted[done] + 1;
      const page = await pdf.getPage(pageNum);
      const size = page.getViewport({ scale: 1 });
      let plan = planPageRender(size.width, size.height, options.dpi, limits);
      // Past the safe size, prove this browser can really hold the canvas.
      if (
        plan.width * plan.height > SAFE_CANVAS.maxPixels ||
        Math.max(plan.width, plan.height) > SAFE_CANVAS.maxEdge
      ) {
        if (!canvasHoldsSize(plan.width, plan.height)) {
          plan = planPageRender(size.width, size.height, options.dpi);
        }
      }
      const blob = await renderPdfPage(page, plan, (canvas) =>
        png ? canvasToPngBlob(canvas) : canvasToJpegBlob(canvas, quality),
      );
      results.push({
        id: crypto.randomUUID(),
        name: `${base}-page-${pageNum}.${png ? "png" : "jpg"}`,
        size: blob.size,
        blob,
        originalSize: item.size,
        note: pageRenderNote(pageNum, plan, options.dpi),
      });
      onProgress((done + 1) / wanted.length);
    }
  } finally {
    await pdf.loadingTask.destroy();
  }

  return results;
}

export const processPdfToJpg = processPdfToImages;
export const processPdfToPng = processPdfToImages;

/** Smallest only: flattening pages has to beat the kept-text result by this much. */
const RASTER_MUST_BEAT = 0.6;
const HEAVY_RASTER = { scale: 0.95, quality: 0.44 };

export function pdfBlob(bytes: Uint8Array) {
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

export { stripPdfMetadata };

/**
 * Flattens every page to JPEG, but only for scans: returns null as soon as a
 * page has selectable text, since flattening would throw that text away.
 */
async function rasterizeScan(bytes: Uint8Array): Promise<Blob | null> {
  const { getDocument } = await loadPdfJs();
  const src = await getDocument({ data: bytes.slice() }).promise;
  const out = await PDFDocument.create();
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const text = await page.getTextContent();
      if (text.items.some((item) => "str" in item && item.str.trim())) {
        return null;
      }
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
 * draws them, in a worker. Smallest may still flatten a scan to JPEG, but
 * only when it has no selectable text and flattening is far smaller.
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
      const raster = await rasterizeScan(bytes);
      if (raster && raster.size < best.size * RASTER_MUST_BEAT) best = raster;
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
  const choices =
    options.kind === "protect"
      ? options
      : {
          password: requirePassword(options, "Protect PDF"),
          ownerPassword: "",
          allowPrint: true,
          allowCopy: true,
          allowEdit: true,
          allowAnnotate: true,
        };
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await PDFDocument.load(await item.file.arrayBuffer(), {
      ignoreEncryption: true,
    });
    doc.encrypt(encryptionFor(choices));
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
  const password =
    options.kind === "unlock" || options.kind === "password"
      ? options.password
      : requirePassword(options, "Unlock PDF");
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await unlockPdfBytes(
        new Uint8Array(await item.file.arrayBuffer()),
        password,
      );
    } catch (error) {
      if (error instanceof WrongPasswordError) {
        throw new Error(
          password
            ? `Wrong password for "${item.name}". Check it and try again.`
            : `"${item.name}" needs a password to open. Type it to unlock.`,
        );
      }
      throw error instanceof Error
        ? error
        : new Error(`Could not unlock "${item.name}".`);
    }
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
    const pages = doc.getPages();
    for (const index of resolvePageRange(options.range, pages.length)) {
      const current = toDegrees(pages[index].getRotation());
      pages[index].setRotation(degrees((current + delta) % 360));
      flipPage(doc, pages[index], options.flip ?? "none");
    }
    const pdfBytes = await doc.save({ useObjectStreams: true });
    const blob = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    results.push({
      id: item.id,
      name: replaceExt(item.name, "pdf").replace(
        /\.pdf$/i,
        options.degrees === 0 && options.flip !== "none"
          ? "-flipped.pdf"
          : "-rotated.pdf",
      ),
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
