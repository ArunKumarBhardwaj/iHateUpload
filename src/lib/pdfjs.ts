import type { DocumentInitParameters } from "pdfjs-dist/types/src/display/api";

import { PDFJS_DIR } from "@/lib/wasm-assets";

/**
 * Where pdf.js finds its WASM decoders (OpenJPEG, JBIG2, QCMS), its CMaps, its standard
 * fonts and its ICC profile. With all of them set the worker fetches them itself; without
 * them it falls back to the slow JS decoders and skips ICC colour.
 */
function assetParams(): DocumentInitParameters {
  const base = `${self.location.origin}${PDFJS_DIR}/`;
  return {
    wasmUrl: `${base}wasm/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    iccUrl: `${base}iccs/`,
  };
}

/**
 * The legacy build, not the default one. pdf.js 6 calls `Map.getOrInsertComputed`,
 * which no shipping browser has yet, so `page.render` throws on every engine we
 * care about. Only the legacy bundle carries the polyfills for it.
 *
 * The worker in `public/` must come from the same build — `bun run sync-pdf-worker`.
 * `getDocument` here fills in the asset URLs; a caller's own values still win.
 */
export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  const getDocument = (src: DocumentInitParameters) =>
    pdfjs.getDocument({ ...assetParams(), ...src });
  return { ...pdfjs, getDocument };
}
