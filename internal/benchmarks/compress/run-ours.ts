// Our engine at each level on every corpus file. Usage: bun internal/benchmarks/compress/run-ours.ts [file...]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createWasmCodec } from "../../../src/lib/compress-codec";
import { compressPdfBytes } from "../../../src/lib/compress-engine";
import { COMPRESS_PLANS } from "../../../src/lib/compress-plans";

const dir = join(dirname(fileURLToPath(import.meta.url)), "corpus");
const out = join(dirname(fileURLToPath(import.meta.url)), "out");
mkdirSync(out, { recursive: true });
const codec = createWasmCodec(async (file) => WebAssembly.compile(readFileSync(`public/codecs/${file}`)));
const files = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(dir).filter((f) => f.endsWith(".pdf")).map((f) => join(dir, f));
const timings: Record<string, number> = {};
for (const file of files) {
  const bytes = new Uint8Array(readFileSync(file));
  for (const [level, plan] of Object.entries(COMPRESS_PLANS)) {
    const t0 = performance.now();
    const { bytes: result } = await compressPdfBytes(bytes, plan, codec);
    const name = `${basename(file, ".pdf")}.ours-${level}.pdf`;
    timings[name] = Math.round(performance.now() - t0);
    writeFileSync(join(out, name), result);
  }
}
writeFileSync(join(out, "timings.json"), JSON.stringify(timings, null, 1));
console.log(timings);
