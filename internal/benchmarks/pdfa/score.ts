// Scores ours vs iLovePDF on the PDF/A corpus: veraPDF, text kept, visual match to the source (PDFKit), size.
// Usage: bun internal/benchmarks/pdfa/score.ts   (after prove.mjs and rival-ilovepdf.mjs)
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const here = new URL(".", import.meta.url).pathname;
const render = here + "out/render/";
mkdirSync(render, { recursive: true });
const fixtures = readdirSync(here + "fx").filter((f) => f.endsWith(".pdf")).sort();
const levels = ["1b", "2b", "3b"];
const sides = { ours: here + "out/ours/", ilovepdf: here + "out/ilovepdf/" };

const pdfs = [...fixtures.map((f) => here + "fx/" + f)];
for (const dir of Object.values(sides)) for (const f of existsSync(dir) ? readdirSync(dir) : []) if (f.endsWith(".pdf")) pdfs.push(dir + f);
// Rendered names must not clash between sides.
const tagged = (p: string) => (p.includes("/ilovepdf/") ? "ilove-" : p.includes("/ours/") ? "ours-" : "src-") + p.split("/").pop();
for (const p of pdfs) {
  const link = render + tagged(p);
  spawnSync("cp", [p, link]);
}
spawnSync("swift", [here + "render.swift", render, ...pdfs.map((p) => render + tagged(p))], { stdio: "ignore" });

const words = (s: string) => s.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}]+/gu) ?? [];
function recall(src: string, out: string) {
  const want = words(src);
  if (!want.length) return 1;
  const have = new Map<string, number>();
  for (const w of words(out)) have.set(w, (have.get(w) ?? 0) + 1);
  let hit = 0;
  for (const w of want) {
    const n = have.get(w) ?? 0;
    if (n > 0) {
      hit++;
      have.set(w, n - 1);
    }
  }
  return hit / want.length;
}
function pages(name: string) {
  return readdirSync(render).filter((f) => f.startsWith(name + ".p") && f.endsWith(".rgba")).sort();
}
function visual(src: string, out: string) {
  const a = pages(src);
  const b = pages(out);
  if (!a.length || a.length !== b.length) return 0;
  let total = 0;
  for (let i = 0; i < a.length; i++) {
    const x = readFileSync(render + a[i]);
    const y = readFileSync(render + b[i]);
    if (x.readUInt32LE(0) !== y.readUInt32LE(0) || x.readUInt32LE(4) !== y.readUInt32LE(4)) return 0;
    let diff = 0;
    for (let k = 8; k < x.length; k += 4) diff += (Math.abs(x[k] - y[k]) + Math.abs(x[k + 1] - y[k + 1]) + Math.abs(x[k + 2] - y[k + 2])) / 3;
    total += 1 - diff / ((x.length - 8) / 4) / 255;
  }
  return total / a.length;
}

type Row = { fixture: string; level: string; side: string; valid: boolean | null; rules: string; text: number; visual: number; kb: number };
const rows: Row[] = [];
for (const f of fixtures) {
  const base = f.replace(/\.pdf$/, "");
  const srcText = existsSync(render + "src-" + f + ".txt") ? readFileSync(render + "src-" + f + ".txt", "utf8") : "";
  for (const level of levels) {
    for (const [side, dir] of Object.entries(sides)) {
      const file = `${dir}${base}-${level}.pdf`;
      if (!existsSync(file)) {
        rows.push({ fixture: base, level, side, valid: null, rules: "no file", text: 0, visual: 0, kb: 0 });
        continue;
      }
      const v = spawnSync("verapdf", ["-f", level, "--format", "text", "-v", file], { encoding: "utf8" }).stdout.trim().split("\n");
      const name = tagged(file);
      rows.push({
        fixture: base,
        level,
        side,
        valid: v[0].startsWith("PASS"),
        rules: v.slice(1).map((l) => l.trim().replace("FAIL ", "")).join(" "),
        text: recall(srcText, existsSync(render + name + ".txt") ? readFileSync(render + name + ".txt", "utf8") : ""),
        visual: visual("src-" + f, name),
        kb: Math.round(statSync(file).size / 102.4) / 10,
      });
    }
  }
}

const pct = (n: number) => (n * 100).toFixed(1);
const lines = ["| fixture | level | ours valid | iLovePDF valid | ours text | iLovePDF text | ours visual | iLovePDF visual | ours KB | iLovePDF KB |", "|---|---|---|---|---|---|---|---|---|---|"];
for (const f of fixtures.map((x) => x.replace(/\.pdf$/, ""))) {
  for (const level of levels) {
    const o = rows.find((r) => r.fixture === f && r.level === level && r.side === "ours")!;
    const t = rows.find((r) => r.fixture === f && r.level === level && r.side === "ilovepdf")!;
    const valid = (r: Row) => (r.valid === null ? "no file" : r.valid ? "PASS" : `FAIL ${r.rules}`);
    lines.push(`| ${f} | ${level} | ${valid(o)} | ${valid(t)} | ${pct(o.text)} | ${pct(t.text)} | ${pct(o.visual)} | ${pct(t.visual)} | ${o.kb} | ${t.kb} |`);
  }
}
const sum = (side: string, key: "text" | "visual") => {
  const r = rows.filter((x) => x.side === side && x.valid !== null);
  return r.reduce((a, b) => a + b[key], 0) / Math.max(1, r.length);
};
const valid = (side: string) => `${rows.filter((r) => r.side === side && r.valid).length}/${rows.filter((r) => r.side === side).length}`;
lines.push("", `Valid: ours ${valid("ours")}, iLovePDF ${valid("ilovepdf")}. Mean text kept: ours ${pct(sum("ours", "text"))}%, iLovePDF ${pct(sum("ilovepdf", "text"))}%. Mean visual match: ours ${pct(sum("ours", "visual"))}%, iLovePDF ${pct(sum("ilovepdf", "visual"))}%.`);
writeFileSync(here + "out/score.md", lines.join("\n") + "\n");
console.log(lines.join("\n"));
