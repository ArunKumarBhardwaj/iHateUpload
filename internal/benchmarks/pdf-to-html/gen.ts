// Writes the pdf-lib fixtures from the unit tests to fx/ (synthetic, invented text). Usage: bun internal/benchmarks/pdf-to-html/gen.ts
import { mkdirSync, writeFileSync } from "node:fs";

import { makeFormattedPdf, makeLinkedPdf, makeSamplePdf, makeShapesPdf } from "../../../src/lib/pdf-to-word/fixture";

const out = new URL("./fx/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
writeFileSync(out + "sample.pdf", await makeSamplePdf());
writeFileSync(out + "formatted.pdf", await makeFormattedPdf());
writeFileSync(out + "linked.pdf", await makeLinkedPdf());
writeFileSync(out + "shapes.pdf", await makeShapesPdf());
console.log("wrote", out);
