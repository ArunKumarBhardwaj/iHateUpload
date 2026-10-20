// Converts fx/*.pdf in bun (stand-in picture decoder) to out/direct-*.pptx, for quick checks without a browser.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { makePng } from "../../../src/lib/pdf-to-word/fixture";
import { convertPdfToPptx } from "../../../src/lib/pdf-to-pptx/convert";

const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
for (const file of readdirSync(fx).filter((f) => f.endsWith(".pdf"))) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(fx + file)), fontExtraProperties: true, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` }).promise;
  const r = await convertPdfToPptx(pdf as never, file, { mode: "editable", size: "match" }, {
    OPS: OPS as unknown as Record<string, number>,
    rasterizeImage: async () => ({ data: makePng(8, 6, [60, 140, 200]), mime: "image/png" }),
  }, () => {});
  writeFileSync(out + "direct-" + file.replace(/\.pdf$/, ".pptx"), r.bytes);
}
