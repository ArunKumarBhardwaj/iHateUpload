import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from "@cantoo/pdf-lib";

import type { FileItem, ResultItem } from "@/lib/job";
import { loadPdfJs } from "@/lib/pdfjs";
import { extractPdfText } from "@/lib/pdf-text";
import {
  processImageToPdf,
  pdfBlob,
  stripPdfMetadata,
} from "@/lib/processors";
import {
  pageBoxToPdf,
  type AnnotatePosition,
  type PageBox,
  type ToolOptions,
} from "@/lib/tool-options";

type ProgressFn = (ratio: number) => void;

function replaceExt(name: string, ext: string) {
  return `${name.replace(/\.[^.]+$/, "")}.${ext}`;
}

function resultFrom(
  item: FileItem | undefined,
  blob: Blob,
  name: string,
  originalSize: number,
  extra?: Pick<ResultItem, "previewText">,
): ResultItem {
  return {
    id: item?.id ?? crypto.randomUUID(),
    name,
    size: blob.size,
    blob,
    originalSize,
    ...extra,
  };
}

async function loadPdf(file: File) {
  return PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
}

function typedSignature(text: string): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.font = "italic 92px Georgia, serif";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 24, canvas.height / 2);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) {
        reject(new Error("Could not draw the signature."));
        return;
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)));
    }, "image/png");
  });
}

async function signatureBytes(options: Extract<ToolOptions, { kind: "sign" }>) {
  if (options.mode === "type") return typedSignature(options.text.trim());
  const raw = options.dataUrl;
  const comma = raw.indexOf(",");
  const binary = atob(comma >= 0 ? raw.slice(comma + 1) : raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function estimateLightCompressBytes(file: File): Promise<number> {
  const doc = await loadPdf(file);
  stripPdfMetadata(doc);
  const bytes = await doc.save({ useObjectStreams: true });
  return Math.min(bytes.length, file.size);
}

export async function processPngToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  return processImageToPdf(files, onProgress);
}

export async function processSignPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "sign") throw new Error("Sign PDF needs a signature.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to sign.");
  const doc = await loadPdf(item.file);
  const page = doc.getPage(options.box.pageIndex);
  if (!page) throw new Error("That page is not in this PDF.");
  onProgress(0.3);
  const ink = await signatureBytes(options);
  const image = await doc.embedPng(ink);
  const size = page.getSize();
  const box = pageBoxToPdf(options.box, size.width, size.height);
  page.drawImage(image, box);
  onProgress(0.8);
  stripPdfMetadata(doc);
  const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
  onProgress(1);
  return [
    resultFrom(
      item,
      blob,
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-signed.pdf"),
      item.size,
    ),
  ];
}

export async function processRedactPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "redact") throw new Error("Redact PDF needs boxes.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to redact.");
  const boxes = options.boxes.filter((box) => box.w > 0.04 && box.h > 0.04);
  if (boxes.length === 0) throw new Error("Draw at least one redaction box.");

  const source = await loadPdf(item.file);
  const out = await PDFDocument.create();
  const boxed = new Map<number, PageBox[]>();
  for (const box of boxes) {
    const list = boxed.get(box.pageIndex) ?? [];
    list.push(box);
    boxed.set(box.pageIndex, list);
  }

  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const src = boxed.size > 0 ? await getDocument({ data: data.slice() }).promise : null;
  try {
    const pageCount = source.getPageCount();
    for (let index = 0; index < pageCount; index++) {
      const marks = boxed.get(index);
      if (!marks || marks.length === 0) {
        const [copied] = await out.copyPages(source, [index]);
        out.addPage(copied);
      } else {
        if (!src) throw new Error("Could not read the PDF page.");
        const page = await src.getPage(index + 1);
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is not available in this browser.");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        // UI origin is top-left. pageBoxToPdf flips Y for pdf-lib; canvas does not.
        ctx.fillStyle = "#000000";
        for (const box of marks) {
          ctx.fillRect(
            box.x * canvas.width,
            box.y * canvas.height,
            box.w * canvas.width,
            box.h * canvas.height,
          );
        }
        const jpeg = await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) =>
              blob
                ? resolve(blob)
                : reject(new Error("Could not encode the page.")),
            "image/jpeg",
            0.82,
          );
        });
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
        const size = source.getPage(index).getSize();
        const pdfPage = out.addPage([size.width, size.height]);
        pdfPage.drawImage(image, {
          x: 0,
          y: 0,
          width: size.width,
          height: size.height,
        });
      }
      onProgress((index + 1) / pageCount);
    }
  } finally {
    if (src) await src.loadingTask.destroy();
  }

  stripPdfMetadata(out);
  const blob = pdfBlob(await out.save({ useObjectStreams: true }));
  onProgress(1);
  return [
    resultFrom(
      item,
      blob,
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-redacted.pdf"),
      item.size,
    ),
  ];
}

export async function processCropPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "crop") throw new Error("Crop PDF needs a crop box.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to crop.");
  const doc = await loadPdf(item.file);
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const size = page.getSize();
    const box = pageBoxToPdf(options.box, size.width, size.height);
    page.setCropBox(box.x, box.y, box.width, box.height);
    page.setMediaBox(box.x, box.y, box.width, box.height);
    onProgress((index + 1) / (pages.length + 1));
  });
  stripPdfMetadata(doc);
  const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
  onProgress(1);
  return [
    resultFrom(
      item,
      blob,
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-cropped.pdf"),
      item.size,
    ),
  ];
}

function stampPoint(
  position: AnnotatePosition,
  width: number,
  height: number,
  textWidth: number,
  size: number,
) {
  switch (position) {
    case "center":
      return { x: (width - textWidth) / 2, y: height / 2 };
    case "diagonal":
      return { x: width * 0.18, y: height * 0.42 };
    case "header":
      return { x: (width - textWidth) / 2, y: height - size - 20 };
    case "footer":
      return { x: (width - textWidth) / 2, y: 18 };
    case "tl":
      return { x: 22, y: height - size - 20 };
    case "tr":
      return { x: width - textWidth - 22, y: height - size - 20 };
    case "bl":
      return { x: 22, y: 18 };
    case "br":
      return { x: width - textWidth - 22, y: 18 };
  }
}

export async function processAnnotatePdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "annotate") {
    throw new Error("Watermark needs stamp settings.");
  }
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();
    pages.forEach((page, index) => {
      const { width, height } = page.getSize();
      const label =
        options.variant === "numbers"
          ? `${index + 1} / ${pages.length}`
          : options.text.trim();
      const size = options.variant === "numbers" ? 11 : 28;
      const textWidth = font.widthOfTextAtSize(label, size);
      const point = stampPoint(
        options.position,
        width,
        height,
        textWidth,
        size,
      );
      page.drawText(label, {
        x: point.x,
        y: point.y,
        size,
        font,
        color: rgb(0.35, 0.35, 0.38),
        opacity: options.opacity,
        rotate: degrees(options.rotation),
      });
    });
    stripPdfMetadata(doc);
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    results.push(
      resultFrom(
        item,
        blob,
        replaceExt(item.name, "pdf").replace(
          /\.pdf$/i,
          options.variant === "numbers" ? "-numbered.pdf" : "-watermarked.pdf",
        ),
        item.size,
      ),
    );
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processFlattenPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    try {
      doc.getForm().flatten();
    } catch {
      // A PDF with no AcroForm still gets a clean rewrite.
    }
    stripPdfMetadata(doc);
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    results.push(
      resultFrom(
        item,
        blob,
        replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-flat.pdf"),
        item.size,
      ),
    );
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processStripMetadata(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    stripPdfMetadata(doc);
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    results.push(
      resultFrom(
        item,
        blob,
        replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-clean.pdf"),
        item.size,
      ),
    );
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processOcrPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "ocr") throw new Error("OCR needs a language.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to make searchable.");
  const { createWorker } = await import("tesseract.js");
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const src = await getDocument({ data: data.slice() }).promise;
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const worker = await createWorker(options.language);
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.6 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const jpeg = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error("Could not encode the page.")),
          "image/jpeg",
          0.82,
        );
      });
      const recognized = await worker.recognize(canvas);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
      const pdfPage = out.addPage([image.width, image.height]);
      pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
      const scaleX = image.width / viewport.width;
      const scaleY = image.height / viewport.height;
      const words =
        recognized.data.blocks?.flatMap((block) =>
          block.paragraphs.flatMap((paragraph) =>
            paragraph.lines.flatMap((line) => line.words),
          ),
        ) ?? [];
      for (const word of words) {
        const text = word.text?.trim();
        if (!text) continue;
        const box = word.bbox;
        const width = Math.max(8, (box.x1 - box.x0) * scaleX);
        const size = Math.max(6, (box.y1 - box.y0) * scaleY * 0.85);
        pdfPage.drawText(text, {
          x: box.x0 * scaleX,
          y: image.height - box.y1 * scaleY,
          size,
          font,
          color: rgb(0, 0, 0),
          opacity: 0.01,
          maxWidth: width,
        });
      }
      onProgress(pageNum / src.numPages);
    }
  } finally {
    await worker.terminate();
    await src.loadingTask.destroy();
  }
  stripPdfMetadata(out);
  const blob = pdfBlob(await out.save({ useObjectStreams: true }));
  onProgress(1);
  return [
    resultFrom(
      item,
      blob,
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-ocr.pdf"),
      item.size,
    ),
  ];
}

function wrapLines(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function processWordToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const mammoth = await import("mammoth");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const extracted = await mammoth.extractRawText({
      arrayBuffer: await item.file.arrayBuffer(),
    });
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pageSize: [number, number] = [595.28, 841.89];
    let page = doc.addPage(pageSize);
    let y = pageSize[1] - 56;
    const lines = extracted.value.split(/\n+/).flatMap((para) =>
      wrapLines(para.trim() || " ", 88),
    );
    for (const line of lines) {
      if (y < 56) {
        page = doc.addPage(pageSize);
        y = pageSize[1] - 56;
      }
      page.drawText(line, {
        x: 56,
        y,
        size: 11,
        font,
        color: rgb(0.1, 0.1, 0.12),
      });
      y -= 16;
    }
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    results.push(resultFrom(item, blob, replaceExt(item.name, "pdf"), item.size));
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processExcelToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const XLSX = await import("xlsx");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const workbook = XLSX.read(await item.file.arrayBuffer(), { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = (sheet
      ? (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][])
      : []) as (string | number | boolean | null)[][];
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pageSize: [number, number] = [841.89, 595.28];
    let page = doc.addPage(pageSize);
    let y = pageSize[1] - 40;
    const colWidth = 110;
    for (const row of rows.slice(0, 80)) {
      if (y < 36) {
        page = doc.addPage(pageSize);
        y = pageSize[1] - 40;
      }
      (row ?? []).slice(0, 7).forEach((cell, col) => {
        const text = cell == null ? "" : String(cell).slice(0, 22);
        page.drawText(text, {
          x: 28 + col * colWidth,
          y,
          size: 9,
          font,
          color: rgb(0.12, 0.12, 0.14),
        });
      });
      y -= 14;
    }
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    results.push(resultFrom(item, blob, replaceExt(item.name, "pdf"), item.size));
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processAskPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "ask") throw new Error("Ask PDF needs a question.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to ask about.");
  onProgress(0.2);
  const text = await extractPdfText(item.file);
  onProgress(0.55);
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, question: options.question.trim() }),
  });
  const payload = (await response.json()) as { answer?: string; error?: string };
  if (response.status === 503) {
    throw new Error(
      "Ask PDF is not configured on this host. The PDF never left this tab.",
    );
  }
  if (!response.ok || !payload.answer) {
    throw new Error(payload.error ?? "The model could not answer.");
  }
  const blob = new Blob([payload.answer], { type: "text/plain" });
  onProgress(1);
  return [
    resultFrom(item, blob, "answer.txt", item.size, {
      previewText: payload.answer,
    }),
  ];
}
