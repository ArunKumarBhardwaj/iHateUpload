// Usage: node bench/wave2-d/text.mjs in.pdf  -> prints text of each page (one item per line)
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
export async function pdfText(path) {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(path)), verbosity: 0 }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const c = await (await doc.getPage(n)).getTextContent();
    pages.push(c.items.filter((i) => "str" in i && i.str.trim()).map((i) => i.str).join(" "));
  }
  return pages;
}
if (process.argv[1].endsWith("text.mjs") && process.argv[2]) console.log((await pdfText(process.argv[2])).map((t, i) => `p${i + 1}: ${t}`).join("\n"));
