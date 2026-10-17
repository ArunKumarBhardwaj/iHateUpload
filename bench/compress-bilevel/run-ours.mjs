// Runs our compression engine at each level in bun (WASM loads from public/codecs).
// Usage: bun bench/compress-bilevel/run-ours.mjs <in.pdf> <outDir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createWasmCodec } from "../../src/lib/compress-codec.ts";
import { compressPdfBytes } from "../../src/lib/compress-engine.ts";
import { COMPRESS_PLANS } from "../../src/lib/compress-plans.ts";

const [input, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const codec = createWasmCodec(async (file) => WebAssembly.compile(readFileSync(`public/codecs/${file}`)));
const bytes = new Uint8Array(readFileSync(input));
for (const [name, plan] of Object.entries(COMPRESS_PLANS)) {
  const t0 = performance.now();
  const { bytes: out, stats } = await compressPdfBytes(bytes, plan, codec);
  const ms = performance.now() - t0;
  writeFileSync(join(outDir, `ours-${name}.pdf`), out);
  console.log(name.padEnd(7), String(out.length).padStart(9), "bytes", Math.round(ms), "ms", JSON.stringify(stats));
}
