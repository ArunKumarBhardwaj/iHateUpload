// Quick offline conversion (no browser): bun bench/wave2-b/pptx-direct.ts in.pptx out.pdf
import { readFileSync, writeFileSync } from "node:fs";
import { convertPptxToPdf } from "../../src/lib/doc-render/pptx";
import { loadFont } from "../../src/lib/doc-render/testkit";
const r = await convertPptxToPdf(readFileSync(process.argv[2]), { loadFont, rasterise: async () => null });
writeFileSync(process.argv[3], r.bytes);
console.log(r.pageCount, "pages", r.bytes.length, "bytes", r.warnings);
