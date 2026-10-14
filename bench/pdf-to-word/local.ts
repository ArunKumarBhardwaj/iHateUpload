/** Fast loop: converts fixtures with our engine in Node (no browser) and prints our feature scores.
 *  Usage: bun bench/pdf-to-word/local.ts [name,name] ; set WRITE=dir to keep the .docx files. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { makePng } from "../../src/lib/pdf-to-word/fixture";
import { convertPdf } from "../../src/lib/pdf-to-word";
import { scoreDocx } from "./score";
import type { Truth } from "./types";

const HERE = import.meta.dirname;
const only = process.argv[2]?.split(",");
const names = (only ?? ["columns", "footnotes", "forms", "header-footer", "images", "links", "lists-headings", "rich-formatting", "table-borderless", "table-multipage", "table-ruled", "vectors"]);
const out = process.env.WRITE;
if (out) mkdirSync(out, { recursive: true });
for (const name of names) {
  const data = new Uint8Array(readFileSync(join(HERE, "fixtures", name + ".pdf")));
  const pdf = await getDocument({ data, fontExtraProperties: true, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/` }).promise;
  const res = await convertPdf(pdf as never, name, { mode: "editable", language: "eng" }, {
    OPS: OPS as unknown as Record<string, number>,
    rasterizeImage: async () => ({ data: makePng(6, 4, [10, 120, 200]), mime: "image/png" }),
  }, () => {});
  if (out) writeFileSync(join(out, name + ".docx"), res.bytes);
  const truth: Truth = JSON.parse(readFileSync(join(HERE, "fixtures", name + ".truth.json"), "utf8"));
  const s = await scoreDocx(res.bytes, truth);
  console.log(name.padEnd(18), s.overall.toFixed(2), Object.entries(s.features).map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" "));
}
