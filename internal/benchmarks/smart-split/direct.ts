// Scores Smart split's boundary finder on the text bundles from gen.mjs, straight from pdf.js text
// (the scanned twins need OCR, so prove.mjs checks those in the real page).
// Usage: bun internal/benchmarks/smart-split/direct.ts [--why]
import { readFileSync } from "node:fs";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";

import { findDocuments, linesFromItems, type PageInfo } from "@/lib/smart-split/detect";

const fx = new URL("./fx/", import.meta.url).pathname;
const truth = JSON.parse(readFileSync(fx + "truth.json", "utf8")) as Record<string, { pages: number; starts: number[]; blanks: number[]; docs: string[] }>;
const why = process.argv.includes("--why");
let tp = 0, fp = 0, fn = 0, exact = 0, n = 0;
const cont: { score: number; at: string }[] = [];
const real: number[] = [];
for (const [name, t] of Object.entries(truth)) {
  if (name.endsWith("-scan")) continue;
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(`${fx}${name}.pdf`)), verbosity: 0 }).promise;
  const pages: PageInfo[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const { width, height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const fonts = [...new Set(content.items.filter((i) => "str" in i && (i as { str: string }).str.trim()).map((i) => (content.styles[(i as { fontName: string }).fontName]?.fontFamily ?? "") + "/" + (i as { fontName: string }).fontName))];
    const items = content.items
      .filter((i) => "str" in i)
      .map((i) => ({ str: (i as { str: string }).str, x: (i as { transform: number[] }).transform[4], y: height - (i as { transform: number[] }).transform[5], size: Math.hypot((i as { transform: number[] }).transform[2], (i as { transform: number[] }).transform[3]) }));
    const lines = linesFromItems(items, height, width);
    // Blank means no text and nothing painted: an image-only page is a scan, not a separator.
    const ops = await page.getOperatorList();
    const paints = ops.fnArray.filter((f) => [OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.fill, OPS.eoFill, OPS.stroke, OPS.fillStroke].includes(f)).length;
    pages.push({ lines, width, height, blank: lines.length === 0 && paints === 0, fonts, scanned: lines.length === 0 && paints > 0 });
  }
  const plan = findDocuments(pages);
  for (const sc of plan.scored) (t.starts.includes(sc.page) ? real.push(sc.score) : cont.push({ score: sc.score, at: `${name} p${sc.page + 1} ${sc.reasons.join("; ")}` }));
  const got = plan.starts.map((s) => s.page);
  const hit = got.filter((p) => t.starts.includes(p)).length;
  tp += hit - 1; fp += got.length - hit; fn += t.starts.length - hit; n++;
  const ok = got.join() === t.starts.join();
  if (ok) exact++;
  console.log(`${ok ? "OK  " : "MISS"} ${name}: want ${t.starts.join(",")} got ${got.join(",")}${t.blanks.length ? ` blanks ${plan.blanks.join(",")}` : ""}`);
  if (why || !ok) {
    for (const s of plan.starts) console.log(`      p${s.page + 1} ${s.label} — ${s.reasons.join("; ")} (${s.score})`);
    for (const s of plan.scored) if (s.score < 2.5 && t.starts.includes(s.page)) console.log(`      missed p${s.page + 1}: ${s.score} ${s.reasons.join("; ")} | ${pages[s.page].lines.slice(0, 4).map((l) => l.text).join(" / ")}`);
  }
}
const precision = tp / Math.max(1, tp + fp), recall = tp / Math.max(1, tp + fn);
cont.sort((a, b) => b.score - a.score);
console.log("highest continuation pages:", cont.slice(0, 4));
console.log("lowest real starts:", real.sort((a, b) => a - b).slice(0, 6).join(" "));
console.log(`cuts: precision ${precision.toFixed(2)} recall ${recall.toFixed(2)}; bundles split exactly ${exact}/${n}`);
