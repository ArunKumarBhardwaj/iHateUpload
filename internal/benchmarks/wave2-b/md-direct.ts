// Offline Markdown conversion: bun internal/benchmarks/wave2-b/md-direct.ts in.md out.pdf [lineSpacing]
import { readFileSync, writeFileSync } from "node:fs";
import { convertDoc } from "../../../src/lib/doc-render/process";
import { defaultDocOptions } from "../../../src/lib/doc-render/options";
import { loadFont } from "../../../src/lib/doc-render/testkit";
const t = readFileSync(process.argv[2], "utf8");
const o = { ...defaultDocOptions("markdown"), lineSpacing: Number(process.argv[4] ?? 1) };
const r = await convertDoc(process.argv[2], { text: async () => t, bytes: async () => new ArrayBuffer(0) }, o, { loadFont });
writeFileSync(process.argv[3], r.bytes);
console.log(r.pageCount, "pages", r.bytes.length, "bytes");
