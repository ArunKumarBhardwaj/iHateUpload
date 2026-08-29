import imageCompression from "browser-image-compression";
import { PDFDocument } from "pdf-lib";

import type { FileItem, ResultItem } from "@/lib/job";

type ProgressFn = (ratio: number) => void;

function replaceExt(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}

async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfjs;
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

async function imageFileToJpegBlob(file: File, quality = 0.92): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas is not available in this browser.");
  }
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvasToJpegBlob(canvas, quality);
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
  const heic2any = await loadHeic2Any();
  const results: ResultItem[] = [];

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const converted = await heic2any({
      blob: item.file,
      toType: "image/jpeg",
      quality: 0.92,
    });
    const blob = Array.isArray(converted) ? converted[0] : converted;
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
