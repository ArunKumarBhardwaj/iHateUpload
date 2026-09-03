/**
 * The legacy build, not the default one. pdf.js 6 calls `Map.getOrInsertComputed`,
 * which no shipping browser has yet, so `page.render` throws on every engine we
 * care about. Only the legacy bundle carries the polyfills for it.
 *
 * The worker in `public/` must come from the same build — `bun run sync-pdf-worker`.
 */
export async function loadPdfJs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  }
  return pdfjs;
}
