// Scores converted HTML (run.mjs + extract.mjs output) against ground truth. Usage: bun internal/benchmarks/pdf-to-html/score.ts [--fx]
// text      character error rate over sorted words (word F1 of characters for CJK/RTL), ignores order and line splits
// order     LCS of the word sequence over the words both share
// headings  F1 of truth headings found as h1-h6 with the same text; levelOK = same level too
// tables    share of truth cells found as cells of one real <table>
// lists     share of truth list items found inside real ul/ol
// links     share of truth links found as <a href>
// visual    page screenshot vs the PDF rendered by PDFKit (same SSIM-of-ink-maps measure as the PDF to Word benchmark)
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { normalise, readingOrder, textAccuracy } from "../pdf-to-word/score";
import { charAccuracy } from "../pdf-to-word/realistic/score-real";
import { pageSimilarity, type Grey } from "../pdf-to-word/realistic/visual";

const HERE = import.meta.dirname;
const FX = process.argv.includes("--fx");
const RES = join(HERE, FX ? "results-fx" : "results");
const PDFS = FX ? join(HERE, "fx") : join(HERE, "../pdf-to-word/realistic/corpus");
const SIDES = ["ours-reflow", "ours-exact", "ours-picture", "rival-semantic", "rival-positioned"];
const PAGE_SIDES = new Set(["ours-exact", "ours-picture", "rival-positioned"]);
const BIN = join(HERE, "../pdf-to-word/realistic/results/.pdf2png");
const FONTS = `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`;

type Truth = {
  paragraphs: string[];
  charMode?: boolean;
  headings?: { text: string; level: number }[];
  tables?: { rows: { text: string }[][] }[];
  lists?: { items: string[] }[];
  links?: { url: string }[];
};

/** For the pdf-lib fixtures: text from pdf.js, structure written by hand from how each fixture is built. */
const FX_STRUCTURE: Record<string, Partial<Truth>> = {
  sample: {
    headings: [{ text: "Quarterly Report", level: 1 }, { text: "Appendix", level: 1 }],
    tables: [{ rows: [["Item", "Qty", "Price"], ["Apples", "3", "4.50"], ["Pears", "7", "9.10"]].map((r) => r.map((text) => ({ text }))) }],
    lists: [{ items: ["First bullet item", "Second bullet item"] }, { items: ["Open the file", "Press convert"] }],
  },
};

async function pdfText(file: string): Promise<string[]> {
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), standardFontDataUrl: FONTS }).promise;
  const out: string[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    // Items are joined as they come (a subscript "2" next to "H" stays "H2"); a line end becomes a space.
    let line = "";
    for (const i of tc.items) {
      if (!("str" in i)) continue;
      if (!/^\s*(•|\d+[.)])\s*$/.test(i.str)) line += i.str;
      if (i.hasEOL) line += " ";
    }
    out.push(line);
  }
  return out;
}

function loadTruth(name: string): Promise<Truth> | Truth {
  if (!FX) return JSON.parse(readFileSync(join(PDFS, name + ".truth.json"), "utf8"));
  return pdfText(join(PDFS, name + ".pdf")).then((paragraphs) => ({ paragraphs, ...FX_STRUCTURE[name] }));
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const N = (s: string) => normalise(s).toLowerCase();

function rasterise(pdf: string, dir: string): Promise<Grey[]> {
  mkdirSync(dir, { recursive: true });
  const r = spawnSync(BIN, [pdf, dir, "600"], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("pdf2png failed: " + r.stderr);
  const pages = Number(/pages=(\d+)/.exec(r.stdout)?.[1] ?? 0);
  return Promise.all(
    Array.from({ length: pages }, async (_, i) => {
      const { data, info } = await sharp(join(dir, `p${i + 1}.png`)).greyscale().raw().toBuffer({ resolveWithObject: true });
      return { w: info.width, h: info.height, data: Float64Array.from(data) };
    }),
  );
}

async function grey(path: string): Promise<Grey> {
  const { data, info } = await sharp(path).flatten({ background: "#fff" }).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: Float64Array.from(data) };
}

type X = { lines: string[]; headings: { level: number; text: string }[]; lists: { items: string[] }[]; tables: string[][][]; links: { href: string }[]; imgs: { data: boolean }[]; selected: number; shots: string[]; title: string; lang: string; htmlBytes: number };
type Row = Record<string, number | undefined> & { ok: number };

function scoreOne(truth: Truth, x: X): Row {
  const row: Row = { ok: 1 };
  row.text = truth.charMode ? charAccuracy(truth.paragraphs, x.lines) : textAccuracy(truth.paragraphs, x.lines);
  row.order = truth.charMode ? undefined : (readingOrder(truth.paragraphs, x.lines) ?? undefined);
  if (truth.headings?.length) {
    const hyp = x.headings.map((h) => ({ ...h, t: N(h.text) }));
    const used = new Set<number>();
    let hit = 0;
    let lvl = 0;
    for (const t of truth.headings) {
      const i = hyp.findIndex((h, k) => !used.has(k) && h.t === N(t.text));
      if (i >= 0) { used.add(i); hit++; if (hyp[i].level === t.level) lvl++; }
    }
    const f1 = (m: number) => (m ? (2 * m) / (truth.headings!.length + hyp.length) : 0);
    row.headings = f1(hit);
    row.levelOK = f1(lvl);
  }
  if (truth.tables?.length) {
    const cells = truth.tables.flatMap((t) => t.rows.flat().map((c) => N(c.text)));
    let best = 0;
    // Each truth table is matched against the page's table with the most of its cells.
    let found = 0;
    for (const t of truth.tables) {
      const want = t.rows.flat().map((c) => N(c.text));
      best = 0;
      for (const tbl of x.tables) {
        const have = new Set(tbl.flat().map(N));
        best = Math.max(best, want.filter((w) => have.has(w)).length);
      }
      found += best;
    }
    row.tables = found / Math.max(1, cells.length);
  }
  if (truth.lists?.length) {
    const have = new Set(x.lists.flatMap((l) => l.items.map(N)));
    const want = truth.lists.flatMap((l) => l.items.map(N));
    row.lists = want.filter((w) => [...have].some((h) => h === w || h.endsWith(w))).length / want.length;
  }
  if (truth.links?.length) {
    const have = x.links.map((l) => l.href);
    row.links = truth.links.filter((l) => have.includes(l.url)).length / truth.links.length;
  }
  row.selectable = x.selected > 20 ? 1 : 0;
  return row;
}

mkdirSync(join(RES, ".render"), { recursive: true });
if (!existsSync(BIN)) {
  mkdirSync(join(HERE, "../pdf-to-word/realistic/results"), { recursive: true });
  const c = spawnSync("swiftc", ["-O", join(HERE, "../pdf-to-word/realistic/pdf2png.swift"), "-o", BIN], { encoding: "utf8" });
  if (c.status !== 0) throw new Error("swiftc failed: " + c.stderr);
}
const names = readdirSync(PDFS).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).sort();
const table: Record<string, Record<string, Row | null>> = {};
for (const name of names) {
  const truth = await loadTruth(name);
  const orig = await rasterise(join(PDFS, name + ".pdf"), join(RES, ".render", name));
  table[name] = {};
  for (const side of SIDES) {
    const xf = join(RES, side, name + ".x.json");
    if (!existsSync(xf)) { table[name][side] = null; continue; }
    const x: X = JSON.parse(readFileSync(xf, "utf8"));
    const row = scoreOne(truth, x);
    if (PAGE_SIDES.has(side) && x.shots.length) {
      const pages = orig.map(async (o, i) => (x.shots[i] ? pageSimilarity(o, await grey(x.shots[i])) : 0));
      row.visual = mean(await Promise.all(pages));
    }
    row.images = x.imgs.filter((i) => i.data).length;
    table[name][side] = row;
  }
}

const METRICS = ["text", "order", "headings", "levelOK", "tables", "lists", "links", "visual", "selectable"];
const f2 = (n?: number) => (n === undefined || Number.isNaN(n) ? "-" : n.toFixed(2));
let md = `# PDF to HTML: scores (${FX ? "pdf-lib fixtures" : "realistic corpus"}, ${names.length} documents)\n\n`;
md += "A document that failed to convert counts as 0 on every metric it has truth for. `-` = no truth for that metric.\n\n";
md += `| Side | Converted | ${METRICS.join(" | ")} |\n|---|---|${METRICS.map(() => "---").join("|")}|\n`;
const summary: Record<string, Record<string, number>> = {};
for (const side of SIDES) {
  const rows = names.map((n) => table[n][side]);
  const okN = rows.filter(Boolean).length;
  const avg: Record<string, number> = {};
  const cells = METRICS.map((m) => {
    const hasTruth = names.filter((n, i) => rows[i] !== null || true).length;
    void hasTruth;
    // Which docs carry truth for this metric: those where any side produced a number.
    const docs = names.filter((n) => SIDES.some((s) => table[n][s]?.[m] !== undefined));
    if (!docs.length || (m === "visual" && !PAGE_SIDES.has(side))) return "-";
    const v = mean(docs.map((n) => table[n][side]?.[m] ?? 0));
    avg[m] = v;
    return f2(v);
  });
  summary[side] = avg;
  md += `| ${side} | ${okN}/${names.length} | ${cells.join(" | ")} |\n`;
}
md += "\n## Per document\n\n";
for (const m of ["text", "headings", "tables", "visual"]) {
  md += `### ${m}\n\n| doc | ${SIDES.join(" | ")} |\n|---|${SIDES.map(() => "---").join("|")}|\n`;
  for (const n of names) md += `| ${n} | ${SIDES.map((s) => (table[n][s] === null ? "FAIL" : f2(table[n][s]?.[m] as number | undefined))).join(" | ")} |\n`;
  md += "\n";
}
writeFileSync(join(RES, "scoreboard.md"), md);
writeFileSync(join(RES, "scoreboard.json"), JSON.stringify({ summary, table }, null, 1));
console.log(md.split("## Per document")[0]);
