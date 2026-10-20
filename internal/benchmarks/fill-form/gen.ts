// Writes the synthetic form used by prove.mjs and rival.mjs. Usage: bun internal/benchmarks/fill-form/gen.ts
import { writeFileSync } from "node:fs";
import { buildPlainPdf, buildSyntheticForm } from "../../../src/lib/fill-form.fixture";

const dir = new URL("./fx/", import.meta.url).pathname;
writeFileSync(dir + "form.pdf", await buildSyntheticForm());
writeFileSync(dir + "plain.pdf", await buildPlainPdf());
console.log("wrote", dir);
