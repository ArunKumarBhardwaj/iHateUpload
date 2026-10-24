import { PDFDocument } from "@cantoo/pdf-lib";
import type { PDFDocumentProxy } from "pdfjs-dist";

import type { FileItem, ResultItem } from "@/lib/job";
import { loadPdfJs } from "@/lib/pdfjs";
import { canvasToJpeg } from "@/lib/pdf-to-word/raster";
import type { ToolOptions } from "@/lib/tool-options";
import { PDFJS_DIR } from "@/lib/wasm-assets";

import { convertToPdfA, type PictureFn, type TextRun } from "./convert";

/** Picture pages are drawn at this resolution, capped so a poster does not blow up memory. */
const PICTURE_DPI = 200;
const MAX_SIDE = 4000;

const loadFont = async (file: string) => {
  const res = await fetch(`${PDFJS_DIR}/standard_fonts/${file}`);
  if (!res.ok) throw new Error(`Could not load the font ${file}.`);
  return new Uint8Array(await res.arrayBuffer());
};

function pictureFrom(getSource: () => Promise<PDFDocumentProxy>): PictureFn {
  return async (index, { annotations }) => {
    const { AnnotationMode } = await loadPdfJs();
    const src = await getSource();
    const page = await src.getPage(index + 1);
    try {
      // Unrotated, so the picture lines up with the page's own coordinates.
      const base = page.getViewport({ scale: 1, rotation: 0 });
      const scale = Math.min(PICTURE_DPI / 72, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale, rotation: 0 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({
        canvas,
        canvasContext: ctx,
        viewport,
        // Form fields and links stay live on the page; comments are drawn in only when asked.
        annotationMode: annotations ? AnnotationMode.ENABLE_FORMS : AnnotationMode.DISABLE,
      }).promise;
      const jpeg = await canvasToJpeg(canvas, 0.85);
      canvas.width = canvas.height = 0;
      const content = await page.getTextContent();
      const text: TextRun[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const [a, b, c, d, e, f] = item.transform as number[];
        text.push({ str: item.str, x: e, y: f, size: Math.hypot(c, d), width: item.width, angle: Math.atan2(b, a) });
      }
      return { jpeg, text };
    } finally {
      page.cleanup();
    }
  };
}

export async function processPdfToPdfA(
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  if (options.kind !== "pdf-to-pdfa") throw new Error("PDF to PDF/A needs its options.");
  if (files.length === 0) throw new Error("Choose a PDF to convert.");
  const results: ResultItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const item = files[i];
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    } catch {
      throw new Error(`${item.name} could not be opened as a PDF. Try Repair PDF first.`);
    }
    if (doc.isEncrypted) throw new Error(`${item.name} is password-protected. Unlock it first, then convert.`);

    let source: Promise<PDFDocumentProxy> | null = null;
    const getSource = () =>
      (source ??= loadPdfJs().then(({ getDocument }) => getDocument({ data: bytes.slice() }).promise));
    try {
      const report = await convertToPdfA(doc, options.level, {
        loadFont,
        picture: pictureFrom(getSource),
        onProgress: (r) => onProgress((i + r) / files.length),
      });
      const blob = new Blob([report.bytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const pictures = report.pagesAsPictures.length;
      results.push({
        id: crypto.randomUUID(),
        name: `${item.name.replace(/\.pdf$/i, "")}-pdfa-${options.level}.pdf`,
        size: blob.size,
        blob,
        originalSize: item.size,
        note: [
          `PDF/A-${options.level}`,
          report.fontsEmbedded.length ? `${report.fontsEmbedded.length} font${report.fontsEmbedded.length === 1 ? "" : "s"} embedded` : "",
          pictures ? `${pictures} page${pictures === 1 ? "" : "s"} drawn as pictures with searchable text` : "",
          ...report.changes.filter((c) => !c.startsWith("Embedded ") && !c.startsWith("Drew page ")),
        ].filter(Boolean).join(" · "),
      });
    } finally {
      // Set inside the picture callback, which TypeScript cannot see.
      const opened = source as Promise<PDFDocumentProxy> | null;
      if (opened) await (await opened).loadingTask.destroy();
    }
    onProgress((i + 1) / files.length);
  }
  return results;
}
