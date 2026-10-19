// Prints extracted text per page (proves text is selectable/vector). Usage: node bench/page-tools/text.mjs <pdf>
import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), verbosity: 0 }).promise;
for (let i = 1; i <= doc.numPages; i++) {
  const t = await (await doc.getPage(i)).getTextContent();
  console.log(i, JSON.stringify(t.items.map((x) => x.str).join(" ")));
}
