// Decodes every page image of a PDF with pdf.js (its own JBIG2 decoder) and prints size + ink pixel count + a hash,
// as a second opinion next to CoreGraphics. Usage: node bench/compress-bilevel/pdfjs-ink.mjs file.pdf
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const data = new Uint8Array(readFileSync(process.argv[2]));
const doc = await pdfjs.getDocument({ data, verbosity: 1, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, wasmUrl: new URL("../../node_modules/pdfjs-dist/wasm/", import.meta.url).href }).promise;
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const ops = await page.getOperatorList();
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
    const id = ops.argsArray[i][0];
    const store = id.startsWith("g_") ? page.commonObjs : page.objs;
    const img = await new Promise((resolve) => store.get(id, resolve));
    // Kind 1 is 1 bit per pixel packed rows (1 = white); kind 2/3 are RGB(A) bytes.
    let ink = 0;
    const bytes = img.data;
    if (img.kind === 1) {
      const rb = (img.width + 7) >> 3;
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) if (!(bytes[y * rb + (x >> 3)] & (0x80 >> (x & 7)))) ink++;
    } else {
      const ch = img.kind === 2 ? 3 : 4;
      for (let p = 0; p < img.width * img.height; p++) if (bytes[p * ch] < 128) ink++;
    }
    console.log(`page ${n} ${img.width}x${img.height} kind=${img.kind} ink=${ink} md5=${createHash("md5").update(bytes).digest("hex").slice(0, 10)}`);
  }
}
