import type { WorkerOptions } from "tesseract.js";

import { TESSDATA_DIR, TESSERACT_DIR } from "@/lib/wasm-assets";

/**
 * `createWorker` with the worker, the core and the language data served from our origin,
 * never jsdelivr. tesseract.js starts its worker from a blob, so every path must be absolute.
 * `corePath` is a folder: the worker picks relaxed-SIMD, SIMD or plain LSTM by what the
 * browser supports.
 */
export async function createOcrWorker(
  language: string,
  options: Partial<WorkerOptions> = {},
) {
  const { createWorker, OEM } = await import("tesseract.js");
  const origin = self.location.origin;
  return createWorker(language, OEM.LSTM_ONLY, {
    workerPath: `${origin}${TESSERACT_DIR}/worker.min.js`,
    corePath: `${origin}${TESSERACT_DIR}/`,
    langPath: `${origin}${TESSDATA_DIR}`,
    ...options,
  });
}
