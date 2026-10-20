// Scores ours-*.pdf and rival-*.pdf in out/ with pdf.js (readable pages, markers) and strict pdf-lib.
// Usage: bun internal/benchmarks/repair/score.ts   (PDFKit: swift pdfkit-check.swift out/*.pdf)
import { existsSync, readFileSync } from "node:fs";
import { PDFDocument } from "@cantoo/pdf-lib";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DAMAGES, RECOVERABLE } from "../../../src/lib/repair/fixtures";

const out = new URL("./out/", import.meta.url).pathname;
async function score(path: string) {
  if (!existsSync(path)) return "no file";
  const bytes = new Uint8Array(readFileSync(path));
  let strict = "strict ok";
  try { await PDFDocument.load(bytes, { throwOnInvalidObject: true }); } catch { strict = "strict FAIL"; }
  try {
    const doc = await getDocument({ data: bytes, verbosity: VerbosityLevel.ERRORS }).promise;
    let readable = 0, markers = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      try {
        const page = await doc.getPage(n);
        markers += ((await page.getTextContent()).items.map((i) => ("str" in i ? i.str : "")).join(" ").match(/PAGE-\d-MARKER/g) ?? []).length;
        await page.getOperatorList();
        readable++;
      } catch {}
    }
    const r = `${markers} marked / ${readable} of ${doc.numPages} pages readable, ${strict}`;
    await doc.loadingTask.destroy();
    return r;
  } catch { return `pdf.js cannot open, ${strict}`; }
}
for (const d of DAMAGES) {
  console.log(`${d}\twant ${RECOVERABLE[d]}\tours: ${await score(out + "ours-" + d + ".pdf")}\trival: ${await score(out + "rival-" + d + ".pdf")}`);
}
