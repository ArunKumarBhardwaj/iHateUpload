// Quick loop without the app or Gemini: "translates" a PDF with a stand-in (reversed words or upper case) and writes the result.
// Usage: bun internal/benchmarks/translate/direct.ts in.pdf out.pdf [upper|long]
import { readFileSync, writeFileSync } from "node:fs";

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { makePng } from "../../../src/lib/pdf-to-word/fixture";
import { translatePdf } from "../../../src/lib/translate/translate";

const [input, output, mode = "upper"] = process.argv.slice(2);
const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;
const result = await translatePdf(new Uint8Array(readFileSync(input)), {
  deps: { OPS: OPS as unknown as Record<string, number>, rasterizeImage: async () => ({ data: makePng(4, 4, [200, 200, 200]), mime: "image/png" }) },
  loadFont: async (f) => new Uint8Array(readFileSync(`${process.cwd()}/public/fonts/${f}`)),
  script: "latin",
  // "long" makes each text ~35% longer, like English to German or Spanish.
  translate: async (texts) => texts.map((t) => (mode === "long" ? t.split(" ").map((w) => w + (w.length > 3 ? "ungen" : "")).join(" ") : t.toUpperCase())),
  onProgress: () => {},
  open: (data) => getDocument({ data: data.slice(), fontExtraProperties: true, standardFontDataUrl: FONTS, verbosity: 0 }).promise as never,
});
writeFileSync(output, result.bytes);
console.log(`${result.units} units, ${result.bytes.length} bytes`);
