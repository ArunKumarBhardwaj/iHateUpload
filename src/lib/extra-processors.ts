import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
} from "@cantoo/pdf-lib";

import type { PDFPageProxy } from "pdfjs-dist";

import type { ScanPdfPage } from "@/lib/scan/build-pdf";
import type { FileItem, ResultItem } from "@/lib/job";
import { stripInvisibleText } from "@/lib/page-ops";
import { mapPixel } from "@/lib/page-tools/colour";
import { recolourPages, withoutText } from "@/lib/page-tools/invert";
import { flattenAndStrip } from "@/lib/page-tools/flatten";
import { cropPages } from "@/lib/page-tools/crop";
import { resizePages } from "@/lib/page-tools/resize";
import { buildNup } from "@/lib/page-tools/nup";
import { loadPdfJs } from "@/lib/pdfjs";
import { askViaServer } from "@/lib/ask/gemini";
import { extractPdfText } from "@/lib/pdf-text";
import {
  applyMetadata,
  loadForMetadata,
  wipePdfMetadata,
} from "@/lib/pdf-meta";
import { lineDiff } from "@/lib/text-diff";
import {
  expandStamp,
  placeStamps,
  stampedPages,
  type StampContext,
} from "@/lib/header-footer";
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
  resolvePageRange,
  type AnnotatePosition,
  type NumberFormat,
  type EditMark,
  type PageBox,
  type ToolOptions,
  editMarkReady,
  signPlacementReady,
} from "@/lib/tool-options";
import { boxToPlacement, pageFrame } from "@/lib/page-geometry";
import {
  dataUrlBytes,
  drawEditMark,
  hexRgb,
  stripCoveredText,
  type FontCache,
} from "@/lib/edit-draw";
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
  const placements = options.placements.filter(signPlacementReady);
  if (placements.length === 0) throw new Error("Place a signature on the page first.");
  const doc = await loadPdf(item.file);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const embedded = new Map<string, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (let index = 0; index < placements.length; index++) {
    const placement = placements[index];
    const page = doc.getPage(placement.pageIndex);
    if (!page) throw new Error("That page is not in this PDF.");
    const at = boxToPlacement(pageFrame(page), placement);
    if (placement.text?.trim()) {
      const text = keepHelveticaWinAnsi(placement.text).trim();
      const size = Math.max(4, Math.min(at.height * 0.8, 72));
      const fit = font.widthOfTextAtSize(text, size);
      const scaled = fit > at.width ? (size * at.width) / fit : size;
      const lift = (at.height - scaled * 0.7) / 2;
      const a = (at.rotate * Math.PI) / 180;
      page.drawText(text, {
        x: at.x - Math.sin(a) * lift,
        y: at.y + Math.cos(a) * lift,
        size: scaled,
        font,
        color: hexRgb(placement.color ?? "#14161c"),
        rotate: degrees(at.rotate),
      });
    } else if (placement.dataUrl) {
      let image = embedded.get(placement.dataUrl);
      if (!image) {
        const bytes = dataUrlBytes(placement.dataUrl);
        image = placement.dataUrl.includes("image/jpeg")
          ? await doc.embedJpg(bytes)
          : await doc.embedPng(bytes);
        embedded.set(placement.dataUrl, image);
      }
      page.drawImage(image, {
        x: at.x,
        y: at.y,
        width: at.width,
        height: at.height,
        rotate: degrees(at.rotate),
      });
    }
    onProgress(0.1 + (0.8 * (index + 1)) / placements.length);
  }
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
  const fonts: FontCache = new Map();
  const removed = await stripCoveredText(doc, marks);
  onProgress(0.15);
  for (let index = 0; index < marks.length; index++) {
    const mark = marks[index];
    const page = doc.getPage(mark.pageIndex);
    if (!page) continue;
    await drawEditMark(doc, page, fonts, mark, removed.get(mark.id) ?? 0);
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

/** Hand-drawn boxes plus every finding the reader kept. */
export function redactionBoxes(
  options: Extract<ToolOptions, { kind: "redact" }>,
): PageBox[] {
  return [
    ...options.boxes,
    ...options.findings.filter((f) => f.accepted),
  ]
    .filter((box) => box.w > 0.004 && box.h > 0.004)
    .map(({ pageIndex, x, y, w, h }) => ({ pageIndex, x, y, w, h }));
}

export async function processRedactPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "redact") throw new Error("Redact PDF needs boxes.");
  const item = files[0];
  if (!item) throw new Error("Choose a PDF to redact.");
  const boxes = redactionBoxes(options);
  if (boxes.length === 0) {
    throw new Error("Draw a box or accept a finding to redact.");
  }

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
        if (options.removeHidden) stripInvisibleText(copied);
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

  if (options.stripMeta) {
    stripPdfMetadata(out);
  } else {
    out.setTitle(source.getTitle() ?? "");
    out.setAuthor(source.getAuthor() ?? "");
    out.setSubject(source.getSubject() ?? "");
  }
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
  const whole = (r: { x: number; y: number; w: number; h: number }) =>
    r.x <= 0.0005 && r.y <= 0.0005 && r.w >= 0.999 && r.h >= 0.999;
  const rectFor = (index: number) =>
    options.applyAll ? options.box : (options.perPage[index] ?? null);
  const changed = doc.getPages().some((_, i) => {
    const r = rectFor(i);
    return r !== null && !whole(r);
  });
  if (!changed) {
    throw new Error("Nothing to crop yet. Drag the box or type margins first.");
  }
  cropPages(doc, (index) => {
    const r = rectFor(index);
    return r && !whole(r) ? r : null;
  });
  onProgress(0.7);
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
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "flatten") throw new Error("Flatten needs its options.");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    const name = replaceExt(item.name, "pdf").replace(/\.pdf$/i, "-flat.pdf");
    const done = (n: number) => onProgress((i + n) / files.length);
    if (options.mode === "form") {
      flattenAndStrip(doc, options.strip);
      if (!options.strip.metadata) {
        // Keep the author's own metadata; only the producer changes.
        doc.setProducer("iHateUpload");
      } else {
        stripPdfMetadata(doc);
      }
      results.push(
        resultFrom(item, pdfBlob(await doc.save({ useObjectStreams: true })), name, item.size),
      );
      done(1);
      continue;
    }
    // Full flatten: apply the strips to the source, then draw each page as a picture.
        // Burn fields in first so ticked boxes and typed values are drawn; "strip forms" removes them instead.
    flattenAndStrip(doc, options.strip, { flattenForm: !options.strip.forms });
    const { getDocument } = await loadPdfJs();
    const src = await getDocument({
      data: new Uint8Array(await doc.save()),
    }).promise;
    const out = await PDFDocument.create();
    const scale = Math.min(400, Math.max(96, options.dpi)) / 72;
    try {
      for (let n = 1; n <= src.numPages; n++) {
        const page = await src.getPage(n);
        const { width, height } = page.getViewport({ scale: 1 });
        const { canvas } = await renderPageCanvas(page, scale);
        const jpeg = await canvasToJpeg(canvas, 0.85);
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
        const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
        out.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
        done(n / src.numPages);
      }
    } finally {
      await src.loadingTask.destroy();
    }
    stripPdfMetadata(out);
    results.push(
      resultFrom(item, pdfBlob(await out.save({ useObjectStreams: true })), name, item.size),
    );
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
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const pageSize: [number, number] = [841.89, 595.28];
    const colWidth = 110;
    // Every sheet, each starting on its own page under its name.
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const rows = (sheet
        ? (XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][])
        : []) as (string | number | boolean | null)[][];
      let page = doc.addPage(pageSize);
      let y = pageSize[1] - 40;
      page.drawText(pdfSafe(name), { x: 28, y, size: 12, font: bold });
      y -= 22;
      for (const row of rows) {
        if (y < 36) {
          page = doc.addPage(pageSize);
          y = pageSize[1] - 40;
        }
        (row ?? []).slice(0, 7).forEach((cell, col) => {
          const text = cell == null ? "" : pdfSafe(String(cell).slice(0, 22));
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

export async function processScanToPdf(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "scan") return processImageToPdf(files, onProgress);
  const { createScanClient } = await import("@/lib/scan/client");
  const { buildScanPdf } = await import("@/lib/scan/build-pdf");
  const client = createScanClient();
  type Worker = Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>;
  let ocr: Worker | null = null;
  let current = 0;
  try {
    if (options.searchable) {
      const { createWorker, PSM } = await import("tesseract.js");
      ocr = await createWorker(options.language, 1, {
        logger: (message) => {
          if (message.status !== "recognizing text") return;
          onProgress(Math.min(0.97, (current + 0.5 + message.progress / 2) / files.length));
        },
      });
      await ocr.setParameters({
        user_defined_dpi: "72",
        tessedit_pageseg_mode: PSM.AUTO,
      });
    }
    const pages: ScanPdfPage[] = [];
    let unread = 0;
    for (let i = 0; i < files.length; i++) {
      current = i;
      const item = files[i];
      const edit = options.pages[item.id];
      const settings = {
        corners: edit?.corners ?? null,
        rotate: edit?.rotate ?? 0,
        filter: options.filter,
        brightness: options.brightness,
        contrast: options.contrast,
      };
      const page = await client.final(item.id, item.file, settings, ocr !== null);
      onProgress((i + 0.5) / files.length);
      let textPdf: Uint8Array | null = null;
      if (ocr && page.ocr) {
        try {
          const blob = new Blob([page.ocr.bytes.slice().buffer as ArrayBuffer], { type: page.ocr.type });
          const read = await ocr.recognize(blob, { pdfTitle: "Scan" }, OCR_RECOGNIZE_OUTPUT);
          textPdf = tessPdfBytes(read.data.pdf);
        } catch {
          textPdf = null;
        }
        if (!textPdf) unread++;
      }
      pages.push({ width: page.width, height: page.height, kind: page.kind, bytes: page.bytes, textPdf });
      onProgress((i + 1) / files.length);
    }
    if (unread > 0 && unread === pages.length) {
      throw new Error("The text could not be read. Turn off Searchable PDF, or try another language.");
    }
    const bytes = await buildScanPdf(pages, options.pageSize);
    const total = files.reduce((n, f) => n + f.size, 0);
    return [
      resultFrom(files[0], pdfBlob(bytes), "scan.pdf", total),
    ];
  } finally {
    client.dispose();
    await ocr?.terminate();
  }
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
  options?: ToolOptions,
): Promise<ResultItem[]> {
  const ocr = options?.kind === "extract-text" ? options.ocr : false;
  const language = options?.kind === "extract-text" ? options.language : "eng";
  const engine = await import("@/lib/text-extract");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const step = (ratio: number) => onProgress((i + ratio) / files.length);
    let text: string;
    let note: string | undefined;
    if (item.file.type.startsWith("image/")) {
      if (!ocr) {
        throw new Error("Pictures need OCR. Turn on OCR scanned pages.");
      }
      text = await engine.extractImageText(item.file, {
        ocr,
        language,
        onProgress: step,
      });
    } else {
      const { pages, ocrPages } = await engine.extractPdfPages(item.file, {
        ocr,
        language,
        onProgress: step,
      });
      text = engine.joinPages(pages);
      if (ocrPages.length > 0) {
        note = `Read with OCR: page${ocrPages.length === 1 ? "" : "s"} ${ocrPages.join(", ")}.`;
      }
    }
    if (!text.trim()) {
      throw new Error(
        ocr
          ? `No text found in "${item.name}".`
          : `"${item.name}" has no selectable text. Turn on OCR scanned pages to read it.`,
      );
    }
    const blob = new Blob([text], { type: "text/plain" });
    const result = resultFrom(item, blob, replaceExt(item.name, "txt"), item.size, {
      previewText: text,
    });
    if (note) result.note = note;
    results.push(result);
    onProgress((i + 1) / files.length);
  }
  return results;
}

export async function processExtractImages(
  files: FileItem[],
  onProgress: ProgressFn,
  options: ToolOptions,
): Promise<ResultItem[]> {
  const engine = await import("@/lib/extract-images");
  return engine.processExtractImages(files, onProgress, options);
}

export type PdfImage = {
  width: number;
  height: number;
  data?: Uint8Array | Uint8ClampedArray | null;
  kind?: number;
  bitmap?: CanvasImageSource | ImageData | null;
};

export async function imageObject(
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

export function rasterToPng(img: PdfImage): Promise<Blob> {
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
  const answer = await askViaServer(
    [{ name: item.name, text }],
    [{ role: "user", content: options.question.trim() }],
  );
  const blob = new Blob([answer], { type: "text/plain" });
  onProgress(1);
  return [
    resultFrom(item, blob, "answer.txt", item.size, {
      previewText: answer,
    }),
  ];
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
  const time = new Date().toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const [red, green, blue] = parseHexColor(options.color);
  const color = rgb(red, green, blue);
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const doc = await loadPdf(item.file);
    const font = await doc.embedFont(
      options.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica,
    );
    const pages = doc.getPages();
    const size = options.fontSize;
    const ctx: StampContext = {
      pages: pages.length,
      date,
      time,
      filename: pdfSafe(item.name.replace(/\.pdf$/i, "")),
    };
    const stamped = stampedPages(options.range, options.skipFirst, pages.length);
    pages.forEach((page, index) => {
      if (!stamped.has(index)) return;
      const { width, height } = page.getSize();
      const placed = placeStamps(
        {
          left: pdfSafe(expandStamp(options.left, index + 1, ctx)),
          center: pdfSafe(expandStamp(options.center, index + 1, ctx)),
          right: pdfSafe(expandStamp(options.right, index + 1, ctx)),
          band: options.band,
          fontSize: size,
          margin: options.margin,
        },
        width,
        height,
        (text) => font.widthOfTextAtSize(text, size),
      );
      for (const stamp of placed) {
        page.drawText(stamp.text, { x: stamp.x, y: stamp.y, size, font, color });
      }
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
  if (!item) throw new Error("Choose a PDF to recolour.");
  const suffix = {
    invert: "-inverted.pdf",
    dark: "-dark.pdf",
    sepia: "-sepia.pdf",
    grayscale: "-gray.pdf",
  }[options.mode];
  const name = replaceExt(item.name, "pdf").replace(/\.pdf$/i, suffix);

  if (options.engine === "vector") {
    const bytes = await item.file.arrayBuffer();
    const doc = await loadPdf(item.file);
    onProgress(0.2);
    await recolourPages(
      doc,
      options.mode,
      options.mode === "dark" && options.keepHues
        ? await withoutText(bytes)
        : undefined,
    );
    onProgress(0.9);
    stripPdfMetadata(doc);
    return [
      resultFrom(item, pdfBlob(await doc.save({ useObjectStreams: true })), name, item.size),
    ];
  }

  const { getDocument } = await loadPdfJs();
  const data = new Uint8Array(await item.file.arrayBuffer());
  const src = await getDocument({ data }).promise;
  const out = await PDFDocument.create();
  const scale = Math.min(6, Math.max(0.5, options.dpi / 72));
  try {
    for (let pageNum = 1; pageNum <= src.numPages; pageNum++) {
      const page = await src.getPage(pageNum);
      const { width, height } = page.getViewport({ scale: 1 });
      const { canvas, ctx } = await renderPageCanvas(page, scale);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const buf = pixels.data;
      for (let i = 0; i < buf.length; i += 4) {
        const [r, g, b] = mapPixel(options.mode, buf[i], buf[i + 1], buf[i + 2]);
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
      }
      ctx.putImageData(pixels, 0, 0);
      const jpeg = await canvasToJpeg(canvas, 0.86);
      page.cleanup();
      const image = await out.embedJpg(new Uint8Array(await jpeg.arrayBuffer()));
      const pdfPage = out.addPage([width, height]);
      pdfPage.drawImage(image, { x: 0, y: 0, width, height });
      onProgress(pageNum / src.numPages);
    }
  } finally {
    await src.loadingTask.destroy();
  }
  stripPdfMetadata(out);
  return [
    resultFrom(item, pdfBlob(await out.save({ useObjectStreams: true })), name, item.size),
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
  const out = await buildNup(source, options, onProgress);
  stripPdfMetadata(out);
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(
        /\.pdf$/i,
        `-${options.cols * options.rows}up.pdf`,
      ),
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
  const out = await resizePages(source, options, onProgress);
  stripPdfMetadata(out);
  const tag = options.size === "custom" ? "resized" : options.size;
  return [
    resultFrom(
      item,
      pdfBlob(await out.save({ useObjectStreams: true })),
      replaceExt(item.name, "pdf").replace(/\.pdf$/i, `-${tag}.pdf`),
      item.size,
    ),
  ];
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
