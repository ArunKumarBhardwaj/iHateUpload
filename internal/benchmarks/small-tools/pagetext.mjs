// Prints the text of every page of a PDF: node pagetext.mjs file.pdf  ->  "F1 B4 F2 ..."
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const root = new URL("../../../", import.meta.url).pathname;
const pdfjs = await import(createRequire(root).resolve("pdfjs-dist/legacy/build/pdf.mjs"));

export async function pageTexts(path) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const text = await (await doc.getPage(i)).getTextContent();
    out.push(text.items.map((t) => t.str).join("").trim());
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2]) console.log((await pageTexts(process.argv[2])).join(" "));
