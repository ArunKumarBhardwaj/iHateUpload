/**
 * Where the WASM engines find their files on our own origin. `scripts/sync-wasm-assets.ts`
 * copies them out of node_modules at prebuild; the version is in each path, so the service
 * worker can keep them cache-first and a dependency bump lands at a fresh URL.
 */
export const TESSERACT_VERSION = "7.0.0";
export const TESSDATA_VERSION = "4.0.0_best_int";
export const PDFJS_VERSION = "6.2.108";

export const TESSERACT_DIR = `/tesseract/${TESSERACT_VERSION}`;
export const TESSDATA_DIR = `/tessdata/${TESSDATA_VERSION}`;
export const PDFJS_DIR = `/pdfjs/${PDFJS_VERSION}`;

/** Every language a tool offers: OCR_LANGUAGES and SCAN_LANGUAGES together. */
export const TESSDATA_LANGUAGES = [
  "eng", "hin", "spa", "fra", "deu", "por", "ita", "ara", "ben", "chi_sim",
  "nld", "pol", "tur", "swe", "rus", "ukr", "chi_tra", "jpn", "kor", "vie",
] as const;

/** Version-pinned paths the service worker may serve from cache before the network. */
export const VERSIONED_ASSET = /^\/(?:tesseract|tessdata|pdfjs)\//;
