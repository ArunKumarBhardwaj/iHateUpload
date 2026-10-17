// Makes a longer PDF by repeating a PDF's pages. Usage: bun bench/compress-bilevel/repeat-pages.mjs in.pdf out.pdf 20
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";

const [input, output, total] = process.argv.slice(2);
const src = await PDFDocument.load(readFileSync(input));
const out = await PDFDocument.create();
for (let i = 0; i < Number(total); i++) {
  const [page] = await out.copyPages(src, [i % src.getPageCount()]);
  out.addPage(page);
}
writeFileSync(output, await out.save());
console.log("wrote", output);
