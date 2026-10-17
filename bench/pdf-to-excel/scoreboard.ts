// Scores results/<side>/<doc>.xlsx against the truth files and prints a markdown scoreboard.
// Usage: bun bench/pdf-to-excel/scoreboard.ts   (after run.mjs)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readSheets, scoreWorkbook, type TruthTable } from "./score";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS: { name: string; dir: string }[] = [
  ...["invoice", "bank-statement", "spreadsheet", "receipt", "report-chart"].map((name) => ({ name, dir: join(HERE, "../pdf-to-word/realistic/corpus") })),
  ...["ledger", "orders", "parts", "scan-invoice", "scan-parts", "scan-orders"].map((name) => ({ name, dir: join(HERE, "corpus") })),
];
const timings: Record<string, number | null> = existsSync(join(HERE, "results/timings.json"))
  ? JSON.parse(readFileSync(join(HERE, "results/timings.json"), "utf8"))
  : {};

const pct = (x: number | null) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
const lines = [
  "| doc | tables (truth) | ours cells | theirs cells | ours typed | theirs typed | ours tables | theirs tables | ours ms | theirs ms |",
  "|---|---|---|---|---|---|---|---|---|---|",
];
const sums = { oc: 0, tc: 0, ot: 0, tt: 0, otn: 0, ttn: 0, n: 0, nt: 0 };
for (const { name, dir } of DOCS) {
  const truth: TruthTable[] = JSON.parse(readFileSync(join(dir, `${name}.truth.json`), "utf8")).tables ?? [];
  const score = (side: string) => {
    const file = join(HERE, "results", side, `${name}.xlsx`);
    return existsSync(file) ? scoreWorkbook(truth, readSheets(new Uint8Array(readFileSync(file)))) : null;
  };
  const o = score("ours");
  const t = score("rival");
  if (truth.length) {
    sums.n++;
    sums.oc += o?.cells ?? 0;
    sums.tc += t?.cells ?? 0;
    if (o?.typed != null) { sums.ot += o.typed; sums.otn++; }
    if (t?.typed != null) { sums.tt += t.typed; sums.ttn++; }
  }
  const tab = (s: typeof o) => (s ? `${s.tablesOut}${s.tablesOk ? " ok" : " X"}` : "n/a");
  lines.push(
    `| ${name} | ${truth.length} | ${truth.length ? pct(o?.cells ?? null) : "-"} | ${truth.length ? pct(t?.cells ?? null) : "-"} | ${pct(o?.typed ?? null)} | ${pct(t?.typed ?? null)} | ${tab(o)} | ${tab(t)} | ${timings[`ours/${name}`] ?? "n/a"} | ${timings[`rival/${name}`] ?? "n/a"} |`,
  );
}
lines.push(
  `| **mean (docs with tables)** | | ${pct(sums.oc / sums.n)} | ${pct(sums.tc / sums.n)} | ${pct(sums.otn ? sums.ot / sums.otn : null)} | ${pct(sums.ttn ? sums.tt / sums.ttn : null)} | | | | |`,
);
const out = lines.join("\n");
console.log(out);
writeFileSync(join(HERE, "results/scoreboard.md"), out + "\n");
