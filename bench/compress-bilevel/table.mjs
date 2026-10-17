// Size + OCR word recall for every PDF given. Renders each page with the Swift PDFKit helper (Quartz, so JBIG2/CCITT decode as in Preview).
// Usage: bun bench/compress-bilevel/table.mjs <truth.json> <width> a.pdf b.pdf ...
// First: swiftc -O bench/pdf-to-word/realistic/pdf2png.swift -o .scratch/pdf2png
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { createWorker } from "tesseract.js";

const [truthPath, width, ...pdfs] = process.argv.slice(2);
const truth = JSON.parse(readFileSync(truthPath, "utf8"));
const tokens = (s) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
function recall(expected, got) {
  const bag = new Map();
  for (const t of tokens(got)) bag.set(t, (bag.get(t) ?? 0) + 1);
  const want = tokens(expected);
  let hit = 0;
  for (const t of want) {
    const n = bag.get(t) ?? 0;
    if (n > 0) {
      hit++;
      bag.set(t, n - 1);
    }
  }
  return (100 * hit) / Math.max(want.length, 1);
}

const worker = await createWorker("eng", 1, { cachePath: ".scratch/tess-cache" });
console.log("file".padEnd(26), "bytes".padStart(9), " OCR recall % per page (avg)");
for (const pdf of pdfs) {
  const dir = join(".scratch/render", basename(pdf, ".pdf") + "-" + width);
  mkdirSync(dir, { recursive: true });
  execFileSync(".scratch/pdf2png", [pdf, dir, width], { stdio: "ignore" });
  const scores = [];
  for (let i = 0; i < truth.length; i++) {
    const { data } = await worker.recognize(join(dir, `p${i + 1}.png`));
    scores.push(recall(truth[i], data.text));
  }
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(basename(pdf).padEnd(26), String(statSync(pdf).size).padStart(9), " ", scores.map((s) => s.toFixed(0).padStart(3)).join(" "), ` (${avg.toFixed(1)})`);
}
await worker.terminate();
