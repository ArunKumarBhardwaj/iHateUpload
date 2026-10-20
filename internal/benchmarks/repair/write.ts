// Writes damaged fixtures to fx/ and our repaired outputs to out/. Usage: bun internal/benchmarks/repair/write.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { getDocument, VerbosityLevel } from "pdfjs-dist/legacy/build/pdf.mjs";
import { DAMAGES, buildDamaged } from "../../../src/lib/repair/fixtures";
import { repairPdf, reportLine } from "../../../src/lib/repair/repair";

const fx = new URL("./fx/", import.meta.url).pathname;
const out = new URL("./out/", import.meta.url).pathname;
mkdirSync(fx, { recursive: true });
mkdirSync(out, { recursive: true });
const open = (b: Uint8Array) => getDocument({ data: b, verbosity: VerbosityLevel.ERRORS }).promise;
for (const d of DAMAGES) {
  const bad = await buildDamaged(d);
  writeFileSync(fx + d + ".pdf", bad);
  const r = await repairPdf(bad, open);
  writeFileSync(out + "ours-" + d + ".pdf", r.bytes);
  console.log(d, r.report.method, reportLine(r.report));
}
