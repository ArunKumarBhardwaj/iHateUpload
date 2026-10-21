/**
 * PDF to HTML on the shared document engine (the one PDF to Word and PDF to
 * PowerPoint use). Always makes one self-contained page with pictures inlined;
 * with output "zip" it also makes index.html plus an images/ folder.
 */
import JSZip from "jszip";
import type { PDFDocumentProxy } from "pdfjs-dist";

import { buildDocument, type ConvertDeps } from "@/lib/pdf-to-word";
import type { DocModel, MediaFile } from "@/lib/pdf-to-word/model";

import { writePagesHtml, writeReflowHtml, type HtmlEnv } from "./html-writer";

export type HtmlMode = "reflow" | "exact" | "picture";

export type HtmlConvertOptions = {
  mode: HtmlMode;
  /** One .html with pictures inlined, or a .zip with index.html and images/. */
  output: "html" | "zip";
  /** 1-based page numbers to convert, in order; all pages when missing. */
  pages?: number[];
};

export type HtmlResult = {
  /** The self-contained page, pictures inlined. */
  html: string;
  /** Zip output: index.html and images/ as files. */
  files?: { path: string; data: Uint8Array | string }[];
  zipBytes?: Uint8Array;
  notes: string[];
  pages: number;
};

const EXT: Record<MediaFile["mime"], string> = { "image/png": "png", "image/jpeg": "jpg" };

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const dataUri = (file: MediaFile) => `data:${file.mime};base64,${toBase64(file.data)}`;

/** A 1x1 picture: picture mode only needs the text, so pictures are not decoded for real. */
const STUB: MediaFile = {
  mime: "image/png",
  data: Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0)),
};

export async function convertPdfToHtml(
  pdf: PDFDocumentProxy,
  name: string,
  options: HtmlConvertOptions,
  deps: ConvertDeps,
  onProgress: (ratio: number) => void,
): Promise<HtmlResult> {
  const pages = options.pages?.length ? options.pages : Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const picture = options.mode === "picture";
  if (picture && !deps.renderJpeg) throw new Error("Page images are not available here.");

  const useDeps: ConvertDeps = picture ? { ...deps, rasterizeImage: async () => STUB } : deps;
  const built = await buildDocument(
    pdf,
    { mode: options.mode === "reflow" ? "editable" : "exact", embedFonts: false },
    useDeps,
    (r) => onProgress(r * (picture ? 0.6 : 0.95)),
    pages,
  );
  const model: DocModel = built.model;
  const media: Record<string, MediaFile> = { ...built.media };
  const pageImages: MediaFile[] = [];
  if (picture) {
    for (let i = 0; i < pages.length; i++) {
      const page = await pdf.getPage(pages[i]);
      pageImages.push({ data: await deps.renderJpeg!(page), mime: "image/jpeg" });
      page.cleanup();
      onProgress(0.6 + (0.38 * (i + 1)) / pages.length);
    }
  }

  const render = (env: HtmlEnv, pictureSrc?: (i: number) => string | null) =>
    options.mode === "reflow"
      ? writeReflowHtml(model, media, env)
      : writePagesHtml(model, env, options.mode === "picture" ? "picture" : "exact", pictureSrc);

  const html = render(
    { name, img: (ref) => (media[ref] ? dataUri(media[ref]) : null) },
    (i) => (pageImages[i] ? dataUri(pageImages[i]) : null),
  );
  const result: HtmlResult = { html, notes: built.notes, pages: pages.length };

  if (options.output === "zip") {
    const files: NonNullable<HtmlResult["files"]> = [];
    const paths = new Map<string, string>();
    const add = (key: string, file: MediaFile) => {
      let path = paths.get(key);
      if (!path) {
        path = `images/${key.startsWith("page") && picture ? key : `image-${paths.size + 1}`}.${EXT[file.mime]}`;
        paths.set(key, path);
        files.push({ path, data: file.data });
      }
      return path;
    };
    const indexHtml = render(
      { name, img: (ref) => (media[ref] ? add(ref, media[ref]) : null) },
      (i) => (pageImages[i] ? add(`page${i + 1}`, pageImages[i]) : null),
    );
    files.unshift({ path: "index.html", data: indexHtml });
    const zip = new JSZip();
    for (const f of files) zip.file(f.path, f.data);
    result.files = files;
    result.zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  }
  onProgress(1);
  return result;
}
