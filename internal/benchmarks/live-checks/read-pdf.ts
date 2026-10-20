// Prints page count, page size and the text layer of a PDF. Usage: bun internal/benchmarks/live-checks/read-pdf.ts file.pdf
import { readFileSync } from "node:fs";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
const doc = await getDocument({ data: new Uint8Array(readFileSync(process.argv[2])), verbosity: VerbosityLevel.ERRORS }).promise;
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  const { width, height } = page.getViewport({ scale: 1 });
  const text = (await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ").replace(/\s+/g, " ");
  console.log(`page ${n}: ${Math.round(width)}x${Math.round(height)} pt — ${text}`);
}
