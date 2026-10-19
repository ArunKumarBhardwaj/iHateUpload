// Word accuracy of OCR on rendered pages vs the known text. Usage: bun internal/benchmarks/compress-bilevel/score.mjs <truth.json> <pngDir> [width]
// pngDir holds p1.png..pN.png (from internal/benchmarks/pdf-to-word/realistic/pdf2png.swift). Prints per-page recall (%).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createWorker } from "tesseract.js";

const [truthPath, dir] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(truthPath, "utf8"));
const tokens = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

export function recall(expected, got) {
  const bag = new Map();
  for (const t of tokens(got)) bag.set(t, (bag.get(t) ?? 0) + 1);
  let hit = 0;
  const want = tokens(expected);
  for (const t of want) {
    const n = bag.get(t) ?? 0;
    if (n > 0) {
      hit++;
      bag.set(t, n - 1);
    }
  }
  return (100 * hit) / Math.max(want.length, 1);
}

const worker = await createWorker("eng", 1, { cachePath: "internal/notes/tess-cache" });
const scores = [];
for (let i = 0; i < truth.length; i++) {
  const { data } = await worker.recognize(join(dir, `p${i + 1}.png`));
  scores.push(recall(truth[i], data.text));
}
await worker.terminate();
console.log(scores.map((s) => s.toFixed(1)).join(" "), "avg", (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1));
