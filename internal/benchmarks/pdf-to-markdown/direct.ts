// Quick loop without the app: converts every corpus PDF with convertPdfToMarkdown (no OCR) -> out/direct/<doc>.md
// Usage: bun internal/benchmarks/pdf-to-markdown/direct.ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { convertPdfToMarkdown } from "../../../src/lib/pdf-to-markdown/convert";
import { makePng } from "../../../src/lib/pdf-to-word/fixture";

const corpus = join(import.meta.dirname, "../pdf-to-word/realistic/corpus");
const out = join(import.meta.dirname, "out/direct");
mkdirSync(out, { recursive: true });
for (const f of readdirSync(corpus).filter((x) => x.endsWith(".pdf"))) {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(join(corpus, f))), fontExtraProperties: true, standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`, verbosity: 0 }).promise;
  const r = await convertPdfToMarkdown(pdf as never, f, { output: "md" }, { OPS: OPS as unknown as Record<string, number>, rasterizeImage: async () => ({ data: makePng(4, 4, [200, 200, 200]), mime: "image/png" }) }, () => {});
  writeFileSync(join(out, f.replace(/\.pdf$/, ".md")), r.markdown);
  await pdf.loadingTask.destroy();
}
console.log("done");
