/**
 * PDF to Markdown on the shared document engine, in its flowing (editable)
 * mode: the same headings, lists, tables, links and OCR that PDF to HTML uses.
 * One .md, or with output "zip" index.md plus an images/ folder.
 */
import JSZip from "jszip";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { buildDocument, type ConvertDeps } from "@/lib/pdf-to-word";
import type { MediaFile } from "@/lib/pdf-to-word/model";

import { writeMarkdown } from "./markdown-writer";

export type MarkdownConvertOptions = {
  /** One .md (pictures left out) or a .zip with index.md and images/. */
  output: "md" | "zip";
  /** 1-based page numbers to convert, in order; all pages when missing. */
  pages?: number[];
};

export type MarkdownResult = { markdown: string; zipBytes?: Uint8Array; notes: string[]; pages: number };

const EXT: Record<MediaFile["mime"], string> = { "image/png": "png", "image/jpeg": "jpg" };

export async function convertPdfToMarkdown(
  pdf: PDFDocumentProxy,
  _name: string,
  options: MarkdownConvertOptions,
  deps: ConvertDeps,
  onProgress: (ratio: number) => void,
): Promise<MarkdownResult> {
  const pages = options.pages?.length ? options.pages : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const zip = options.output === "zip";
  // A single .md has nowhere to put pictures, so they are not decoded at all.
  let skipped = 0;
  const useDeps: ConvertDeps = zip
    ? deps
    : { ...deps, rasterizeImage: async () => (skipped++, { mime: "image/png", data: new Uint8Array() }) };
  const built = await buildDocument(pdf, { mode: "editable", embedFonts: false }, useDeps, (r) => onProgress(r * 0.95), pages);
  const notes = [...built.notes];

  const files: { path: string; data: Uint8Array }[] = [];
  const paths = new Map<string, string>();
  const markdown = writeMarkdown(built.model, {
    img: (ref) => {
      const file = built.media[ref];
      if (!zip || !file || !file.data.length) return null;
      let path = paths.get(ref);
      if (!path) {
        path = `images/image-${paths.size + 1}.${EXT[file.mime]}`;
        paths.set(ref, path);
        files.push({ path, data: file.data });
      }
      return path;
    },
  });
  const pictures = Object.keys(built.media).length;
  if (!zip && (skipped || pictures)) {
    const n = Math.max(skipped, pictures);
    notes.push(`${n} picture${n === 1 ? " was" : "s were"} left out; choose Zip with pictures to keep them.`);
  }
  const result: MarkdownResult = { markdown, notes, pages: pages.length };
  if (zip) {
    const archive = new JSZip();
    archive.file("index.md", markdown);
    for (const f of files) archive.file(f.path, f.data);
    if (!files.length) archive.folder("images");
    result.zipBytes = await archive.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  onProgress(1);
  return result;
}
