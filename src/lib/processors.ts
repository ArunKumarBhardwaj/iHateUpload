import imageCompression from "browser-image-compression";
import { PDFDocument, degrees, toDegrees } from "@cantoo/pdf-lib";

import type { FileItem, ResultItem } from "@/lib/job";
import { loadPdfJs } from "@/lib/pdfjs";
import type { ToolOptions } from "@/lib/tool-options";

type ProgressFn = (ratio: number) => void;

function replaceExt(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}

async function loadHeic2Any() {
  const mod = await import("heic2any");
  return mod.default;
}

async function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
  if (!blob) throw new Error("Could not encode JPEG.");
  return blob;
}

async function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("Could not encode PNG.");
  return blob;
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

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas is not available in this browser.");
  }
  if (options?.fillWhite) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
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

async function heicFileToJpegBlob(file: File, quality = 0.92): Promise<Blob> {
  const heic2any = await loadHeic2Any();
  const converted = await heic2any({
    blob: file,
    toType: "image/jpeg",
    quality,
  });
  return Array.isArray(converted) ? converted[0] : converted;
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

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available in this browser.");

    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await canvasToJpegBlob(canvas, 0.9);
    results.push({
      id: crypto.randomUUID(),
      name: `${base}-page-${pageNum}.jpg`,
      size: blob.size,
      blob,
      originalSize: item.size,
    });
    onProgress(pageNum / pdf.numPages);
  }

  return results;
}

export async function processCompressPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const { getDocument } = await loadPdfJs();
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const data = new Uint8Array(await item.file.arrayBuffer());
    const src = await getDocument({ data: data.slice() }).promise;
    const out = await PDFDocument.create();

    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const jpeg = await canvasToJpegBlob(canvas, 0.72);
      const jpegBytes = new Uint8Array(await jpeg.arrayBuffer());
      const image = await out.embedJpg(jpegBytes);
      const pdfPage = out.addPage([image.width, image.height]);
      pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });

      const totalSteps = files.length * src.numPages;
      const done = i * src.numPages + pageNum;
      onProgress(done / (totalSteps + 1));
    }

    const pdfBytes = await out.save({ useObjectStreams: true });
    const compressed = new Blob([pdfBytes.buffer as ArrayBuffer], {
      type: "application/pdf",
    });
    const output = compressed.size < item.size ? compressed : item.file;

    results.push({
      id: item.id,
      name: replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-compressed.pdf"),
      size: output.size,
      blob: output,
      originalSize: item.size,
    });
  }

  onProgress(1);
  return results;
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
