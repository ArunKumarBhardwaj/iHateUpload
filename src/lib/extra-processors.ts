import {
  PDFDocument,
  PageSizes,
  StandardFonts,
  degrees,
  rgb,
} from "@cantoo/pdf-lib";

import type { PDFPageProxy } from "pdfjs-dist";

import type { FileItem, ResultItem } from "@/lib/job";
import { loadPdfJs } from "@/lib/pdfjs";
import { extractPdfText } from "@/lib/pdf-text";
import {
  applyMetadata,
  loadForMetadata,
  wipePdfMetadata,
} from "@/lib/pdf-meta";
import { lineDiff } from "@/lib/text-diff";
import {
  processImageToPdf,
  pdfBlob,
  stripPdfMetadata,
} from "@/lib/processors";
import {
  ghostTextPlacement,
  OCR_RECOGNIZE_OUTPUT,
  keepHelveticaWinAnsi,
  tessPdfBytes,
  wordsFromOcrBlocks,
} from "@/lib/ocr-words";
import {
  NUMBER_SIZES,
  pageBoxToPdf,
  resolvePageRange,
  type AnnotatePosition,
  type NumberFormat,
  type EditMark,
  type PageBox,
  type ToolOptions,
  editMarkReady,
} from "@/lib/tool-options";
import { batesLabel, batesPlacement, batesReady } from "@/lib/bates";
import { parseHexColor, watermarkStamps } from "@/lib/watermark";

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

export async function processEditPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "edit") throw new Error("Edit PDF needs marks to place.");
  const marks = [...options.marks.filter(editMarkReady)].sort(editDrawOrder);
  if (marks.length === 0) {
    throw new Error("Add text, an image, or a highlight first.");
  }
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to edit.");
  const doc = await loadPdf(item.file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  onProgress(0.15);
  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index];
    const page = doc.getPage(mark.pageIndex);
    if (!page) continue;
    const size = page.getSize();
    const box = pageBoxToPdf(mark, size.width, size.height);
    await drawEditMark(doc, page, font, mark, box, size.height);
    onProgress(0.15 + (0.75 * (index + 1)) / marks.length);
  }
  stripPdfMetadata(doc);
  const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
  onProgress(1);
  return [
    resultFrom(
      item,
      blob,
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-edited.pdf"),
      item.size,
    ),
  ];
}

function editDrawOrder(a: EditMark, b: EditMark) {
  const rank = { highlight: 0, rect: 1, image: 2, text: 3 };
  return rank[a.kind] - rank[b.kind];
}

function hexRgb(hex: string) {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((bit) => bit + bit)
          .join("")
      : raw;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return rgb(0.08, 0.09, 0.11);
  return rgb(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  );
}

function dataUrlBytes(raw: string) {
  const comma = raw.indexOf(",");
  const binary = atob(comma >= 0 ? raw.slice(comma + 1) : raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function drawEditMark(
  doc: PDFDocument,
  page: ReturnType<PDFDocument["getPage"]>,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  mark: EditMark,
  box: { x: number; y: number; width: number; height: number },
  pageHeight: number,
) {
  switch (mark.kind) {
    case "highlight":
      page.drawRectangle({
        ...box,
        color: hexRgb(mark.color),
        opacity: 0.38,
        borderWidth: 0,
      });
      return;
    case "rect":
      if (mark.fill) {
        page.drawRectangle({
          ...box,
          color: hexRgb(mark.color),
          opacity: 0.22,
          borderColor: hexRgb(mark.color),
          borderWidth: 1.2,
        });
        return;
      }
      page.drawRectangle({
        ...box,
        borderColor: hexRgb(mark.color),
        borderWidth: 1.5,
      });
      return;
    case "image": {
      const bytes = dataUrlBytes(mark.dataUrl);
      const image = mark.dataUrl.includes("image/png")
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes);
      page.drawImage(image, box);
      return;
    }
    case "text": {
      if (mark.cover) {
        page.drawRectangle({
          x: box.x - 0.6,
          y: box.y - 0.6,
          width: box.width + 1.2,
          height: box.height + 1.2,
          color: hexRgb("#ffffff"),
          borderWidth: 0,
        });
      }
      const text = keepHelveticaWinAnsi(mark.text).trim();
      if (!text) return;
      const fontSize = Math.max(6, Math.min(mark.fontSize * pageHeight, 72));
      page.drawText(text, {
        x: box.x + 0.4,
        y: box.y + Math.max(0, (box.height - fontSize) / 2),
        size: fontSize,
        font,
        color: hexRgb(mark.color),
        maxWidth: Math.max(8, box.width),
      });
    }
  }
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

function toRoman(value: number) {
  if (value < 1 || value > 3999) return String(value);
  const steps: [number, string][] = [
    [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
    [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
  ];
  let rest = value;
  let out = "";
  for (const [step, glyph] of steps) {
    while (rest >= step) {
      out += glyph;
      rest -= step;
    }
  }
  return out;
}

function numberLabel(
  format: NumberFormat,
  shown: number,
  total: number,
): string {
  switch (format) {
    case "n":
      return String(shown);
    case "page":
      return `Page ${shown}`;
    case "n-of":
      return `${shown} / ${total}`;
    case "page-of":
      return `Page ${shown} of ${total}`;
    case "roman":
      return toRoman(shown);
  }
}

/** `resolvePageRange`, with the file's name on the error so a batch says which one. */
function pageRangeFor(item: FileItem, range: string, pageCount: number) {
  try {
    return resolvePageRange(range, pageCount);
  } catch (error) {
    throw new Error(
      `${item.name}: ${error instanceof Error ? error.message : "Enter pages like 1-3, 7."}`,
    );
  }
}

/**
 * Bates numbers run on through every file in the order given: the counter is
 * spent only on pages that are actually stamped, never reset between files.
 */
async function processBatesPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: Extract<ToolOptions, { kind: "annotate" }>,
): Promise<ResultItem[]> {
  if (!batesReady(options)) {
    throw new Error("Check the Bates settings: digits, size, start and prefix.");
  }
  const [red, green, blue] = parseHexColor(options.color);
  const results: ResultItem[] = [];
  const log: string[][] = [];
  let counter = options.startAt;
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const wanted = new Set(pageRangeFor(item, options.range, pages.length));
    const first = counter;
    let stamped = 0;
    pages.forEach((page, index) => {
      if (!wanted.has(index) || (options.skipFirst && index === 0)) return;
      const label = batesLabel(options, counter++);
      stamped++;
      const { width, height } = page.getSize();
      const size = options.batesSize;
      const textWidth = font.widthOfTextAtSize(label, size);
      const point = batesPlacement(
        options.position,
        width,
        height,
        textWidth,
        size,
        options.margin,
      );
      if (options.batesPlate) {
        const pad = size * 0.3;
        page.drawRectangle({
          x: point.x - pad,
          y: point.y - size * 0.25 - pad / 2,
          width: textWidth + pad * 2,
          height: size * 1.2 + pad,
          color: rgb(1, 1, 1),
        });
      }
      page.drawText(label, {
        x: point.x,
        y: point.y,
        size,
        font,
        color: rgb(red, green, blue),
      });
    });
    if (stamped === 0) {
      throw new Error(`${item.name}: no pages left to number.`);
    }
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    const result = resultFrom(
      item,
      blob,
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-bates.pdf"),
      item.size,
    );
    result.note = `${batesLabel(options, first)} to ${batesLabel(options, counter - 1)}`;
    results.push(result);
    log.push([
      item.name,
      result.name,
      batesLabel(options, first),
      batesLabel(options, counter - 1),
      String(stamped),
    ]);
    onProgress((i + 1) / files.length);
  }
  results.push(batesLog(log));
  return results;
}

/** The production log lawyers file with a Bates set: one CSV row per file. */
function batesLog(rows: string[][]): ResultItem {
  const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;
  const head = ["Source file", "Stamped file", "First Bates", "Last Bates", "Pages"];
  const csv = [head, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
  const blob = new Blob([`${csv}\r\n`], { type: "text/csv" });
  return {
    id: crypto.randomUUID(),
    name: "bates-production-log.csv",
    size: blob.size,
    blob,
    originalSize: blob.size,
  };
}

export async function processAnnotatePdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "annotate") {
    throw new Error("Watermark needs stamp settings.");
  }
  if (options.variant === "numbers" && options.bates) {
    return processBatesPdf(files, onProgress, options);
  }
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();
    const numberPoints =
      NUMBER_SIZES.find((entry) => entry.id === options.numberSize)?.points ??
      11;
    const inRange = new Set(
      pageRangeFor(item, options.range, pages.length),
    );
    const [red, green, blue] = parseHexColor(options.color);
    pages.forEach((page, index) => {
      if (options.variant === "numbers" && options.skipFirst && index === 0) {
        return;
      }
      if (!inRange.has(index)) return;
      const { width, height } = page.getSize();
      if (options.variant === "watermark") {
        const text = options.text.trim();
        let stamps;
        try {
          stamps = watermarkStamps(
            options,
            width,
            height,
            (size) => font.widthOfTextAtSize(text, size),
          );
        } catch {
          throw new Error("The stamp can use letters, digits and common punctuation.");
        }
        for (const stamp of stamps) {
          page.drawText(text, {
            x: stamp.x,
            y: stamp.y,
            size: stamp.size,
            font,
            color: rgb(red, green, blue),
            opacity: options.opacity,
            rotate: degrees(stamp.rotation),
          });
        }
        return;
      }
      const label = numberLabel(
        options.numberFormat,
        options.startAt + index,
        options.startAt + pages.length - 1,
      );
      const size = numberPoints;
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
    const doc = await loadForMetadata(await item.file.arrayBuffer());
    wipePdfMetadata(doc);
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

export async function processEditMetadata(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "metadata") {
    throw new Error("Edit metadata needs the fields to write.");
  }
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to edit.");
  if (options.sourceId !== item.id) {
    throw new Error("The properties are still loading. Try again in a moment.");
  }
  const doc = await loadForMetadata(await item.file.arrayBuffer());
  applyMetadata(doc, options);
  const blob = pdfBlob(await doc.save({ useObjectStreams: false }));
  onProgress(1);
  return [
    resultFrom(
      item,
      blob,
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-metadata.pdf"),
      item.size,
    ),
  ];
}

export async function processOcrPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "ocr") throw new Error("OCR needs a language.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to make searchable.");
  const wantPdf = options.output !== "text";
  const wantText = options.output !== "pdf";
  const scale = 2;
  const { createWorker, PSM } = await import("tesseract.js");
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const src = await getDocument({ data: data.slice() }).promise;
  const sourcePdf = wantPdf ? await loadPdf(item.file) : null;
  const out = wantPdf ? await PDFDocument.create() : null;
  let ghostFont: Awaited<ReturnType<PDFDocument["embedFont"]>> | null = null;
  let pageCursor = 0;
  const texts: string[] = [];
  const worker = await createWorker(options.language, 1, {
    logger: (message) => {
      if (message.status !== "recognizing text") return;
      onProgress(
        Math.min(0.96, (pageCursor + message.progress) / src.numPages),
      );
    },
  });
  await worker.setParameters({
    user_defined_dpi: String(Math.round(72 * scale)),
    tessedit_pageseg_mode: PSM.AUTO,
  });
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      pageCursor = pageNum - 1;
      const page = await src.getPage(pageNum);
      if (options.skipTextPages) {
        const existing = await page.getTextContent();
        const already = selectableLength(existing);
        if (already > 40) {
          if (out && sourcePdf) {
            const [copied] = await out.copyPages(sourcePdf, [pageNum - 1]);
            out.addPage(copied);
          }
          if (wantText) {
            texts.push(existingText(existing));
          }
          page.cleanup();
          onProgress(pageNum / src.numPages);
          continue;
        }
      }
      const viewport = page.getViewport({ scale });
      const pointViewport = page.getViewport({ scale: 1 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const recognized = await worker.recognize(
        canvas,
        { pdfTitle: item.name.replace(/\.[^.]+$/, "") },
        OCR_RECOGNIZE_OUTPUT,
      );
      if (wantText) texts.push((recognized.data.text ?? "").trim());
      if (out) {
        const native = tessPdfBytes(recognized.data.pdf);
        let placed = false;
        if (native) {
          try {
            const tess = await PDFDocument.load(native, {
              ignoreEncryption: true,
            });
            if (tess.getPageCount() > 0) {
              const [copied] = await out.copyPages(tess, [0]);
              out.addPage(copied);
              placed = true;
            }
          } catch {
            placed = false;
          }
        }
        if (!placed) {
          if (!ghostFont) {
            ghostFont = await out.embedFont(StandardFonts.Helvetica);
          }
          const jpeg = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (blob) =>
                blob
                  ? resolve(blob)
                  : reject(new Error("Could not encode the page.")),
              "image/jpeg",
              0.86,
            );
          });
          const image = await out.embedJpg(
            new Uint8Array(await jpeg.arrayBuffer()),
          );
          const pdfPage = out.addPage([
            pointViewport.width,
            pointViewport.height,
          ]);
          pdfPage.drawImage(image, {
            x: 0,
            y: 0,
            width: pointViewport.width,
            height: pointViewport.height,
          });
          for (const word of wordsFromOcrBlocks(recognized.data.blocks)) {
            const text = keepHelveticaWinAnsi(word.text).trim();
            if (!text) continue;
            const place = ghostTextPlacement(
              word.bbox,
              pointViewport.width,
              pointViewport.height,
              viewport.width,
              viewport.height,
            );
            pdfPage.drawText(text, {
              x: place.x,
              y: place.y,
              size: place.size,
              font: ghostFont,
              color: rgb(0, 0, 0),
              opacity: 0.01,
              maxWidth: place.maxWidth,
            });
          }
        }
      }
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      onProgress(pageNum / src.numPages);
    }
  } finally {
    await worker.terminate();
    await src.loadingTask.destroy();
  }
  const results: ResultItem[] = [];
  if (out) {
    if (out.getPageCount() < 1) {
      throw new Error("OCR produced no pages.");
    }
    stripPdfMetadata(out);
    const blob = pdfBlob(await out.save({ useObjectStreams: true }));
    results.push(
      resultFrom(
        item,
        blob,
        replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-ocr.pdf"),
        item.size,
      ),
    );
  }
  if (wantText) {
    const body = texts.filter(Boolean).join("\n\n");
    const blob = new Blob([body], { type: "text/plain" });
    results.push(
      resultFrom(
        item,
        blob,
        replaceExt(item.name, "txt").replace(/\.txt$/i, "-ocr.txt"),
        item.size,
        { previewText: body.slice(0, 4000) },
      ),
    );
  }
  onProgress(1);
  return results;
}

function selectableLength(content: { items: unknown[] }) {
  let count = 0;
  for (const item of content.items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    count += String(item.str).trim().length;
  }
  return count;
}

function existingText(content: { items: unknown[] }) {
  const parts: string[] = [];
  for (const item of content.items) {
    if (!item || typeof item !== "object" || !("str" in item)) continue;
    const str = String(item.str);
    if (str) parts.push(str);
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
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
  const { convertDocxToPdf } = await import("@/lib/word-to-pdf/convert");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const out = await convertDocxToPdf(await item.file.arrayBuffer());
    const blob = pdfBlob(out.bytes);
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

function pdfSafe(text: string): string {
  return text.replace(/[^\u0009\u000a\u000d\u0020-\u007e]/g, "?");
}

type DrawnLine = { text: string; size: number };

async function linesToPdf(lines: DrawnLine[]): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageSize: [number, number] = [595.28, 841.89];
  let page = doc.addPage(pageSize);
  let y = pageSize[1] - 56;
  const drawn = lines.length > 0 ? lines : [{ text: "(empty file)", size: 11 }];
  for (const line of drawn) {
    const step = line.size + 5;
    if (y < 56) {
      page = doc.addPage(pageSize);
      y = pageSize[1] - 56;
    }
    page.drawText(line.text || " ", {
      x: 56,
      y,
      size: line.size,
      font,
      color: rgb(0.1, 0.1, 0.12),
    });
    y -= step;
  }
  return pdfBlob(await doc.save({ useObjectStreams: true }));
}

function markdownToLines(source: string): DrawnLine[] {
  const lines: DrawnLine[] = [];
  let inCode = false;
  for (const raw of source.replace(/\r\n/g, "\n").split("\n")) {
    if (raw.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }
    const row = pdfSafe(
      raw
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"),
    );
    if (inCode) {
      lines.push({ text: row.slice(0, 96) || " ", size: 9 });
      continue;
    }
    if (/^###\s+/.test(row)) {
      for (const line of wrapLines(row.replace(/^###\s+/, ""), 72)) {
        lines.push({ text: line, size: 13 });
      }
    } else if (/^##\s+/.test(row)) {
      for (const line of wrapLines(row.replace(/^##\s+/, ""), 64)) {
        lines.push({ text: line, size: 16 });
      }
    } else if (/^#\s+/.test(row)) {
      for (const line of wrapLines(row.replace(/^#\s+/, ""), 56)) {
        lines.push({ text: line, size: 20 });
      }
    } else if (/^\s*[-*]\s+/.test(row)) {
      for (const line of wrapLines(`- ${row.replace(/^\s*[-*]\s+/, "")}`, 86)) {
        lines.push({ text: line, size: 11 });
      }
    } else if (/^\s*\d+\.\s+/.test(row)) {
      for (const line of wrapLines(row.trim(), 86)) {
        lines.push({ text: line, size: 11 });
      }
    } else if (row.trim() === "") {
      lines.push({ text: " ", size: 8 });
    } else {
      for (const line of wrapLines(row.trim(), 88)) {
        lines.push({ text: line, size: 11 });
      }
    }
  }
  return lines;
}

function htmlToLines(html: string): DrawnLine[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const lines: DrawnLine[] = [];
  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") return;
    const size =
      tag === "h1" ? 20 : tag === "h2" ? 16 : tag === "h3" ? 13 : tag === "pre" ? 9 : 11;
    if (["h1", "h2", "h3", "p", "li", "pre", "blockquote"].includes(tag)) {
      const text = pdfSafe((el.textContent ?? "").replace(/\s+/g, " ").trim());
      if (text) {
        for (const line of wrapLines(text, tag === "pre" ? 96 : 88)) {
          lines.push({ text: line, size });
        }
      }
      return;
    }
    if (tag === "tr") {
      const cells = [...el.querySelectorAll("th,td")]
        .map((cell) => pdfSafe((cell.textContent ?? "").replace(/\s+/g, " ").trim()))
        .filter(Boolean);
      if (cells.length) {
        for (const line of wrapLines(cells.join("  |  "), 88)) {
          lines.push({ text: line, size: 10 });
        }
      }
      return;
    }
    for (const child of Array.from(el.childNodes)) walk(child);
  };
  walk(doc.body);
  if (lines.length === 0) {
    const text = pdfSafe((doc.body?.textContent ?? "").replace(/\s+/g, " ").trim());
    if (text) {
      for (const line of wrapLines(text, 88)) {
        lines.push({ text: line, size: 11 });
      }
    }
  }
  return lines;
}

function extractPptxSlideTexts(xml: string): string[] {
  const texts: string[] = [];
  const tagged = xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g);
  for (const match of tagged) {
    const value = pdfSafe(match[1] ?? "").trim();
    if (value) texts.push(value);
  }
  return texts;
}

async function rowsToPdf(
  rows: (string | number | boolean | null)[][],
): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pageSize: [number, number] = [841.89, 595.28];
  let page = doc.addPage(pageSize);
  let y = pageSize[1] - 40;
  const colWidth = 110;
  const drawn = rows.length > 0 ? rows : [["(empty table)"]];
  for (const row of drawn.slice(0, 200)) {
    if (y < 36) {
      page = doc.addPage(pageSize);
      y = pageSize[1] - 40;
    }
    (row ?? []).slice(0, 7).forEach((cell, col) => {
      const text = pdfSafe(cell == null ? "" : String(cell).slice(0, 22));
      if (!text) return;
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
  return pdfBlob(await doc.save({ useObjectStreams: true }));
}

export async function processMarkdownToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const blob = await linesToPdf(markdownToLines(await item.file.text()));
    results.push(resultFrom(item, blob, replaceExt(item.name, "pdf"), item.size));
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processCsvToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const XLSX = await import("xlsx");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const workbook = XLSX.read(await item.file.text(), { type: "string" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = (sheet
      ? (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][])
      : []) as (string | number | boolean | null)[][];
    const blob = await rowsToPdf(rows);
    results.push(resultFrom(item, blob, replaceExt(item.name, "pdf"), item.size));
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processHtmlToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const blob = await linesToPdf(htmlToLines(await item.file.text()));
    results.push(resultFrom(item, blob, replaceExt(item.name, "pdf"), item.size));
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processPptxToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const { default: JSZip } = await import("jszip");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const zip = await JSZip.loadAsync(await item.file.arrayBuffer());
    const names = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const left = Number(a.match(/slide(\d+)/i)?.[1] ?? 0);
        const right = Number(b.match(/slide(\d+)/i)?.[1] ?? 0);
        return left - right;
      });
    if (names.length === 0) {
      throw new Error("This PowerPoint file has no slides.");
    }
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const name of names) {
      const xml = await zip.files[name].async("string");
      const texts = extractPptxSlideTexts(xml);
      const page = doc.addPage([720, 540]);
      let y = 500;
      const drawn = texts.length > 0 ? texts : ["(empty slide)"];
      drawn.forEach((text, index) => {
        const size = index === 0 ? 18 : 12;
        for (const line of wrapLines(text, index === 0 ? 48 : 72)) {
          if (y < 36) return;
          page.drawText(line, {
            x: 40,
            y,
            size,
            font,
            color: rgb(0.1, 0.1, 0.12),
          });
          y -= size + 8;
        }
      });
    }
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    results.push(resultFrom(item, blob, replaceExt(item.name, "pdf"), item.size));
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processScanToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  return processImageToPdf(files, onProgress);
}

async function pdfTextOrEmpty(file: File) {
  try {
    return await extractPdfText(file);
  } catch {
    return "";
  }
}

export async function processComparePdfs(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "compare") throw new Error("Compare PDFs needs two files.");
  const left = files[0];
  const right = files[1];
  if (!left || !right) throw new Error("Add two PDFs to compare.");
  onProgress(0.2);
  const leftText = await pdfTextOrEmpty(left.file);
  onProgress(0.5);
  const rightText = await pdfTextOrEmpty(right.file);
  if (!leftText && !rightText) {
    throw new Error(
      "Neither PDF has selectable text. Run OCR PDF first if they are scans.",
    );
  }
  const header = `--- ${left.name}\n+++ ${right.name}\n`;
  const diff = `${header}${lineDiff(leftText, rightText)}`;
  onProgress(0.9);
  const blob = new Blob([diff], { type: "text/plain" });
  onProgress(1);
  return [
    resultFrom(left, blob, "compare-diff.txt", left.size + right.size, {
      previewText: diff,
    }),
  ];
}

export async function processExtractText(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const text = await extractPdfText(item.file);
    const blob = new Blob([text], { type: "text/plain" });
    results.push(
      resultFrom(item, blob, replaceExt(item.name, "txt"), item.size, {
        previewText: text,
      }),
    );
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processExtractImages(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to pull images from.");
  const pdfjs = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const src = await pdfjs.getDocument({ data }).promise;
  const images: { name: string; blob: Blob }[] = [];
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const ops = await page.getOperatorList();
      const seen = new Set<string>();
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i];
        if (
          fn !== pdfjs.OPS.paintImageXObject &&
          fn !== pdfjs.OPS.paintImageXObjectRepeat &&
          fn !== pdfjs.OPS.paintInlineImageXObject
        ) {
          continue;
        }
        const arg0 = ops.argsArray[i]?.[0];
        const img =
          fn === pdfjs.OPS.paintInlineImageXObject && arg0 && typeof arg0 === "object"
            ? (arg0 as PdfImage)
            : typeof arg0 === "string"
              ? await imageObject(page, arg0)
              : null;
        if (!img) continue;
        const key =
          typeof arg0 === "string"
            ? arg0
            : `${img.width}x${img.height}:${img.data?.length ?? "bitmap"}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const blob = await rasterToPng(img);
        images.push({
          name: `${item.name.replace(/\.[^.]+$/, "")}-p${pageNum}-${images.length + 1}.png`,
          blob,
        });
      }
      page.cleanup();
      onProgress(pageNum / (src.numPages + 1));
    }
  } finally {
    await src.loadingTask.destroy();
  }
  if (images.length === 0) {
    throw new Error("This PDF has no embedded images to extract.");
  }
  onProgress(1);
  return images.map((image) =>
    resultFrom(item, image.blob, image.name, item.size),
  );
}

type PdfImage = {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray | null;
  kind?: number;
  bitmap?: CanvasImageSource | ImageData | null;
};

async function imageObject(
  page: {
    objs: { get: (name: string, cb?: (v: unknown) => void) => unknown };
    commonObjs: { get: (name: string, cb?: (v: unknown) => void) => unknown };
  },
  name: string,
): Promise<PdfImage | null> {
  const raw =
    (await resolveObj(page.objs, name)) ??
    (await resolveObj(page.commonObjs, name));
  if (!raw || typeof raw !== "object") return null;
  const img = raw as PdfImage;
  if (!img.width || !img.height) return null;
  if (!img.data && !img.bitmap) return null;
  return img;
}

function resolveObj(
  objs: { get: (name: string, cb?: (v: unknown) => void) => unknown },
  name: string,
): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      const value = objs.get(name, resolve);
      if (value) resolve(value);
    } catch {
      resolve(null);
    }
  });
}

function rasterToPng(img: PdfImage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  if (img.bitmap && typeof img.bitmap === "object") {
    if (img.bitmap instanceof ImageData) {
      ctx.putImageData(img.bitmap, 0, 0);
    } else {
      ctx.drawImage(img.bitmap, 0, 0);
    }
  } else {
    const src = img.data;
    if (!src) throw new Error("Could not read an embedded image.");
    const out = ctx.createImageData(img.width, img.height);
    const kind = img.kind ?? 3;
    let si = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (kind === 1) {
        const v = src[si++] ?? 0;
        out.data[i] = v;
        out.data[i + 1] = v;
        out.data[i + 2] = v;
        out.data[i + 3] = 255;
      } else if (kind === 2) {
        out.data[i] = src[si++] ?? 0;
        out.data[i + 1] = src[si++] ?? 0;
        out.data[i + 2] = src[si++] ?? 0;
        out.data[i + 3] = 255;
      } else {
        out.data[i] = src[si++] ?? 0;
        out.data[i + 1] = src[si++] ?? 0;
        out.data[i + 2] = src[si++] ?? 0;
        out.data[i + 3] = src[si++] ?? 255;
      }
    }
    ctx.putImageData(out, 0, 0);
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) {
        reject(new Error("Could not encode an extracted image."));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
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

function expandStamp(template: string, page: number, pages: number, date: string) {
  return template
    .replaceAll("{page}", String(page))
    .replaceAll("{pages}", String(pages))
    .replaceAll("{date}", date);
}

export async function processHeaderFooter(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "header-footer") {
    throw new Error("Headers and footers need text.");
  }
  const date = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const size = 10;
    pages.forEach((page, index) => {
      const { width, height } = page.getSize();
      const left = expandStamp(options.left, index + 1, pages.length, date);
      const center = expandStamp(options.center, index + 1, pages.length, date);
      const right = expandStamp(options.right, index + 1, pages.length, date);
      const draw = (y: number) => {
        if (left.trim()) {
          page.drawText(left, { x: 28, y, size, font, color: rgb(0.2, 0.2, 0.22) });
        }
        if (center.trim()) {
          const textWidth = font.widthOfTextAtSize(center, size);
          page.drawText(center, {
            x: (width - textWidth) / 2,
            y,
            size,
            font,
            color: rgb(0.2, 0.2, 0.22),
          });
        }
        if (right.trim()) {
          const textWidth = font.widthOfTextAtSize(right, size);
          page.drawText(right, {
            x: width - 28 - textWidth,
            y,
            size,
            font,
            color: rgb(0.2, 0.2, 0.22),
          });
        }
      };
      if (options.band !== "footer") draw(height - size - 18);
      if (options.band !== "header") draw(18);
    });
    stripPdfMetadata(doc);
    const blob = pdfBlob(await doc.save({ useObjectStreams: true }));
    results.push(
      resultFrom(
        item,
        blob,
        replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-headed.pdf"),
        item.size,
      ),
    );
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processReversePages(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to reverse.");
  const source = await loadPdf(item.file);
  const count = source.getPageCount();
  const out = await PDFDocument.create();
  const order = Array.from({ length: count }, (_, index) => count - 1 - index);
  const copied = await out.copyPages(source, order);
  for (const page of copied) out.addPage(page);
  stripPdfMetadata(out);
  onProgress(1);
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-reversed.pdf"),
      item.size,
    ),
  ];
}

export async function processDeleteBlank(
  files: FileItem[],
  onProgress: ProgressFn,
): Promise<ResultItem[]> {
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to strip blank pages from.");
  const source = await loadPdf(item.file);
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const src = await getDocument({ data }).promise;
  const keep: number[] = [];
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const { canvas, ctx } = await renderPageCanvas(page, 0.35);
      if (!isNearWhite(ctx, canvas.width, canvas.height)) keep.push(pageNum - 1);
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      onProgress(pageNum / (src.numPages + 1));
    }
  } finally {
    await src.loadingTask.destroy();
  }
  if (keep.length === 0) {
    throw new Error("Every page looks blank. Nothing to keep.");
  }
  if (keep.length === source.getPageCount()) {
    throw new Error("No blank pages were found.");
  }
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, keep);
  for (const page of copied) out.addPage(page);
  stripPdfMetadata(out);
  onProgress(1);
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-noblank.pdf"),
      item.size,
    ),
  ];
}

export async function processInsertBlank(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "insert-blank") {
    throw new Error("Insert blank needs a page number.");
  }
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to insert a page into.");
  const source = await loadPdf(item.file);
  const count = source.getPageCount();
  const after = Math.min(count, Math.max(0, options.afterPage));
  const template = source.getPage(after === 0 ? 0 : after - 1).getSize();
  const out = await PDFDocument.create();
  if (after === 0) out.addPage([template.width, template.height]);
  for (let index = 0; index < count; index++) {
    const [copied] = await out.copyPages(source, [index]);
    out.addPage(copied);
    if (index + 1 === after) out.addPage([template.width, template.height]);
    onProgress((index + 1) / (count + 1));
  }
  stripPdfMetadata(out);
  onProgress(1);
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-blank.pdf"),
      item.size,
    ),
  ];
}

export async function processInvertPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "invert") throw new Error("Invert needs a mode.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to invert.");
  const source = await loadPdf(item.file);
  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const src = await getDocument({ data }).promise;
  const out = await PDFDocument.create();
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const { canvas, ctx } = await renderPageCanvas(page, 1.6);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const buf = pixels.data;
      if (options.mode === "invert") {
        for (let i = 0; i < buf.length; i += 4) {
          buf[i] = 255 - (buf[i] ?? 0);
          buf[i + 1] = 255 - (buf[i + 1] ?? 0);
          buf[i + 2] = 255 - (buf[i + 2] ?? 0);
        }
      } else {
        for (let i = 0; i < buf.length; i += 4) {
          const gray = Math.round(
            0.2126 * (buf[i] ?? 0) +
              0.7152 * (buf[i + 1] ?? 0) +
              0.0722 * (buf[i + 2] ?? 0),
          );
          buf[i] = gray;
          buf[i + 1] = gray;
          buf[i + 2] = gray;
        }
      }
      ctx.putImageData(pixels, 0, 0);
      const jpeg = await canvasToJpeg(canvas, 0.86);
      page.cleanup();
      const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
      const size = source.getPage(pageNum - 1).getSize();
      const pdfPage = out.addPage([size.width, size.height]);
      pdfPage.drawImage(image, {
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      });
      onProgress(pageNum / src.numPages);
    }
  } finally {
    await src.loadingTask.destroy();
  }
  stripPdfMetadata(out);
  const suffix = options.mode === "invert" ? "-inverted.pdf" : "-gray.pdf";
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, suffix),
      item.size,
    ),
  ];
}

export async function processNup(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "nup") throw new Error("N-up needs a layout.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to n-up.");
  const source = await loadPdf(item.file);
  const count = source.getPageCount();
  const cols = options.n === 9 ? 3 : 2;
  const rows = options.n === 2 ? 1 : options.n === 4 ? 2 : 3;
  ensurePageContents(source);
  const first = source.getPage(0).getSize();
  const sheet =
    options.n === 2
      ? { width: Math.max(first.width, first.height), height: Math.min(first.width, first.height) }
      : { width: first.width, height: first.height };
  const gutter = 10;
  const cellW = (sheet.width - gutter * (cols + 1)) / cols;
  const cellH = (sheet.height - gutter * (rows + 1)) / rows;
  const out = await PDFDocument.create();
  const sheets = Math.ceil(count / options.n);
  for (let sheetIndex = 0; sheetIndex < sheets; sheetIndex++) {
    const page = out.addPage([sheet.width, sheet.height]);
    for (let slot = 0; slot < options.n; slot++) {
      const srcIndex = sheetIndex * options.n + slot;
      if (srcIndex >= count) break;
      const embedded = await out.embedPage(source.getPage(srcIndex));
      const col = slot % cols;
      const row = Math.floor(slot / cols);
      const scale = Math.min(cellW / embedded.width, cellH / embedded.height);
      const w = embedded.width * scale;
      const h = embedded.height * scale;
      const x = gutter + col * (cellW + gutter) + (cellW - w) / 2;
      const y =
        sheet.height -
        gutter -
        (row + 1) * cellH -
        row * gutter +
        (cellH - h) / 2;
      page.drawPage(embedded, { x, y, width: w, height: h });
    }
    onProgress((sheetIndex + 1) / sheets);
  }
  stripPdfMetadata(out);
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, `-${options.n}up.pdf`),
      item.size,
    ),
  ];
}

export async function processPageSize(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "page-size") throw new Error("Page size needs a sheet.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to resize.");
  const source = await loadPdf(item.file);
  ensurePageContents(source);
  const target = options.size === "a4" ? PageSizes.A4 : PageSizes.Letter;
  const out = await PDFDocument.create();
  const count = source.getPageCount();
  for (let index = 0; index < count; index++) {
    const embedded = await out.embedPage(source.getPage(index));
    const page = out.addPage(target);
    const scale =
      options.fit === "fit"
        ? Math.max(target[0] / embedded.width, target[1] / embedded.height)
        : Math.min(target[0] / embedded.width, target[1] / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawPage(embedded, {
      x: (target[0] - width) / 2,
      y: (target[1] - height) / 2,
      width,
      height,
    });
    onProgress((index + 1) / count);
  }
  stripPdfMetadata(out);
  const tag = options.size === "a4" ? "a4" : "letter";
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, `-${tag}.pdf`),
      item.size,
    ),
  ];
}

function ensurePageContents(doc: PDFDocument) {
  for (const page of doc.getPages()) {
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 0.01,
      height: 0.01,
      opacity: 0,
      borderOpacity: 0,
    });
  }
}

async function renderPageCanvas(page: PDFPageProxy, scale: number) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  return { canvas, ctx };
}

function isNearWhite(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const data = ctx.getImageData(0, 0, width, height).data;
  const step = 16;
  let dark = 0;
  for (let i = 0; i < data.length; i += step) {
    if ((data[i] ?? 255) < 248 || (data[i + 1] ?? 255) < 248 || (data[i + 2] ?? 255) < 248) {
      dark += 1;
    }
  }
  return dark < 20;
}

function canvasToJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) {
        reject(new Error("Could not encode the page."));
        return;
      }
      resolve(blob);
    }, "image/jpeg", quality);
  });
}
