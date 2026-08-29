import imageCompression from "browser-image-compression";
import { PDFDocument } from "pdf-lib";

import type { FileItem, ResultItem } from "@/lib/job";

type ProgressFn = (ratio: number) => void;

function replaceExt(name: string, ext: string) {
  const base = name.replace(/\.[^.]+$/, "");
  return `${base}.${ext}`;
}

async function loadHeic2Any() {
  const mod = await import("heic2any");
  return mod.default;
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
    const output =
      compressed.size < item.size ? compressed : item.file;
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

export async function processImageToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const pdf = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const isPng =
      item.file.type === "image/png" ||
      item.name.toLowerCase().endsWith(".png");
    const image = isPng ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
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
