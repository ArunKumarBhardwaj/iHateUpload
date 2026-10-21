// Quick loop without the browser app: converts a PDF straight through convertPdfToHtml (pictures are placeholders).
// Usage: bun internal/benchmarks/pdf-to-html/direct.ts <in.pdf> <reflow|exact|picture> <out.html>
import { readFileSync, writeFileSync } from "node:fs";

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { convertPdfToHtml } from "../../../src/lib/pdf-to-html/convert";
import { makePng } from "../../../src/lib/pdf-to-word/fixture";

const [input, mode, out] = process.argv.slice(2);
const pdf = await getDocument({ data: new Uint8Array(readFileSync(input)), standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` }).promise;
const result = await convertPdfToHtml(
  pdf as never,
  "direct",
  { mode: mode as "reflow", output: "html" },
  {
    OPS: OPS as unknown as Record<string, number>,
    rasterizeImage: async () => ({ data: makePng(8, 8, [180, 180, 200]), mime: "image/png" }),
    renderJpeg: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  },
  () => {},
);
writeFileSync(out, result.html);
console.log(`${result.pages} pages, ${result.html.length} chars`);
