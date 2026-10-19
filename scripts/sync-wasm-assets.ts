/**
 * Copies the WASM engines' runtime files out of node_modules into public/, at the
 * version-pinned paths in src/lib/wasm-assets.ts. Run by `prebuild`.
 *
 * - tesseract.js: the worker and the three LSTM-only cores (relaxed SIMD, SIMD, plain).
 * - @tesseract.js-data/*: the 4.0.0_best_int models, gzipped. Apache-2.0 (tessdata_best).
 * - pdfjs-dist: openjpeg.wasm, jbig2.wasm, qcms_bg.wasm and their JS fallbacks, the CMaps,
 *   the standard fonts and the ICC profile.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  PDFJS_VERSION,
  PDFJS_DIR,
  TESSDATA_DIR,
  TESSDATA_LANGUAGES,
  TESSDATA_VERSION,
  TESSERACT_DIR,
  TESSERACT_VERSION,
} from "../src/lib/wasm-assets";

const root = fileURLToPath(new URL("..", import.meta.url));
const nm = (...parts: string[]) => join(root, "node_modules", ...parts);
const pub = (path: string) => join(root, "public", path);

function expectVersion(pkg: string, want: string) {
  const { version } = JSON.parse(readFileSync(nm(pkg, "package.json"), "utf8"));
  if (version !== want) {
    throw new Error(`${pkg} is ${version}; update src/lib/wasm-assets.ts to match.`);
  }
}

function copy(from: string, to: string) {
  if (!existsSync(from)) throw new Error(`missing ${from}`);
  cpSync(from, to, { recursive: true });
}

expectVersion("tesseract.js", TESSERACT_VERSION);
expectVersion("pdfjs-dist", PDFJS_VERSION);

for (const dir of ["tesseract", "tessdata", "pdfjs"]) rmSync(pub(dir), { recursive: true, force: true });

const tess = pub(TESSERACT_DIR);
mkdirSync(tess, { recursive: true });
copy(nm("tesseract.js", "dist", "worker.min.js"), join(tess, "worker.min.js"));
copy(nm("tesseract.js", "LICENSE.md"), join(tess, "LICENSE_TESSERACT_JS"));
for (const core of ["relaxedsimd-lstm", "simd-lstm", "lstm"]) {
  const file = `tesseract-core-${core}.wasm.js`;
  copy(nm("tesseract.js-core", file), join(tess, file));
}
copy(nm("tesseract.js-core", "LICENSE"), join(tess, "LICENSE_TESSERACT_CORE"));

const data = pub(TESSDATA_DIR);
mkdirSync(data, { recursive: true });
for (const lang of TESSDATA_LANGUAGES) {
  const file = `${lang}.traineddata.gz`;
  copy(nm("@tesseract.js-data", lang, TESSDATA_VERSION, file), join(data, file));
}
writeFileSync(
  join(data, "LICENSE"),
  "These models are tesseract-ocr/tessdata_best (https://github.com/tesseract-ocr/tessdata_best),\n" +
    "converted to integers by tesseract.js and published as @tesseract.js-data/* on npm.\n" +
    "Licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0\n",
);

const pdfjs = pub(PDFJS_DIR);
mkdirSync(join(pdfjs, "wasm"), { recursive: true });
for (const file of [
  "openjpeg.wasm", "openjpeg_nowasm_fallback.js", "LICENSE_OPENJPEG", "LICENSE_PDFJS_OPENJPEG",
  "jbig2.wasm", "jbig2_nowasm_fallback.js", "LICENSE_JBIG2", "LICENSE_PDFJS_JBIG2",
  "qcms_bg.wasm", "LICENSE_QCMS", "LICENSE_PDFJS_QCMS",
]) {
  copy(nm("pdfjs-dist", "wasm", file), join(pdfjs, "wasm", file));
}
for (const dir of ["cmaps", "standard_fonts", "iccs"]) copy(nm("pdfjs-dist", dir), join(pdfjs, dir));

console.log("synced WASM assets into public/");
