// Scores Markdown files against the realistic corpus truth (same metrics as the PDF to HTML benchmark).
// Every side is parsed by the same standard GFM parser (marked), so nobody's own reading of Markdown counts.
// Usage: bun internal/benchmarks/pdf-to-markdown/score.ts            -> out/score.md
//   Expects out/<side>/<doc>.md for sides "ours" and "ilovepdf" (missing files score 0 where truth exists).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Lexer, type Token, type Tokens } from "marked";

import { normalise, readingOrder, textAccuracy } from "../pdf-to-word/score";
import { charAccuracy } from "../pdf-to-word/realistic/score-real";

const HERE = import.meta.dirname;
const CORPUS = join(HERE, "../pdf-to-word/realistic/corpus");
const OUT = join(HERE, "out");
const SIDES = ["ours", "ilovepdf"];

type Truth = {
  paragraphs: string[];
  charMode?: boolean;
  headings?: { text: string; level: number }[];
  tables?: { rows: { text: string }[][] }[];
  lists?: { items: string[] }[];
  links?: { url: string }[];
};

type Parsed = { lines: string[]; headings: { level: number; text: string }[]; lists: string[][]; tables: string[][][]; links: string[] };

/** Plain text of inline tokens, and the links among them. */
function inlineText(tokens: Token[] | undefined, links: string[]): string {
  return (tokens ?? [])
    .map((t) => {
      if (t.type === "link") links.push((t as Tokens.Link).href);
      if ("tokens" in t && t.tokens) return inlineText(t.tokens, links);
      if (t.type === "br") return " ";
      if (t.type === "image") return "";
      return "text" in t ? String(t.text) : "";
    })
    .join("")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function parse(md: string): Parsed {
  const out: Parsed = { lines: [], headings: [], lists: [], tables: [], links: [] };
  const walk = (tokens: Token[]) => {
    for (const t of tokens) {
      if (t.type === "heading") {
        const text = inlineText((t as Tokens.Heading).tokens, out.links);
        out.headings.push({ level: (t as Tokens.Heading).depth, text });
        out.lines.push(text);
      } else if (t.type === "paragraph") {
        out.lines.push(...inlineText((t as Tokens.Paragraph).tokens, out.links).split("\n"));
      } else if (t.type === "list") {
        const items: string[] = [];
        for (const item of (t as Tokens.List).items) {
          const first = item.tokens.filter((k) => k.type !== "list");
          const text = first.map((k) => ("tokens" in k && k.tokens ? inlineText(k.tokens, out.links) : "text" in k ? String(k.text) : "")).join(" ");
          items.push(text);
          out.lines.push(text);
          walk(item.tokens.filter((k) => k.type === "list"));
        }
        out.lists.push(items);
      } else if (t.type === "table") {
        const table = t as Tokens.Table;
        const rows = [table.header, ...table.rows].map((r) => r.map((c) => inlineText(c.tokens, out.links)));
        out.tables.push(rows);
        for (const r of rows) out.lines.push(r.join(" "));
      } else if (t.type === "blockquote" || t.type === "list_item") {
        walk((t as Tokens.Blockquote).tokens);
      } else if (t.type === "code" || t.type === "html" || t.type === "text") {
        out.lines.push(...String((t as Tokens.Code).text).split("\n"));
      }
    }
  };
  walk(new Lexer({ gfm: true }).lex(md));
  return out;
}

const N = (s: string) => normalise(s).toLowerCase();
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function score(truth: Truth, x: Parsed) {
  const row: Record<string, number | undefined> = {};
  row.text = truth.charMode ? charAccuracy(truth.paragraphs, x.lines) : textAccuracy(truth.paragraphs, x.lines);
  row.order = truth.charMode ? undefined : (readingOrder(truth.paragraphs, x.lines) ?? undefined);
  if (truth.headings?.length) {
    const hyp = x.headings.map((h) => ({ ...h, t: N(h.text) }));
    const used = new Set<number>();
    let hit = 0;
    let lvl = 0;
    for (const t of truth.headings) {
      const i = hyp.findIndex((h, k) => !used.has(k) && h.t === N(t.text));
      if (i >= 0) {
        used.add(i);
        hit++;
        if (hyp[i].level === t.level) lvl++;
      }
    }
    const f1 = (m: number) => (m ? (2 * m) / (truth.headings!.length + hyp.length) : 0);
    row.headings = f1(hit);
    row.levelOK = f1(lvl);
  }
  if (truth.tables?.length) {
    let found = 0;
    let total = 0;
    for (const t of truth.tables) {
      const want = t.rows.flat().map((c) => N(c.text));
      total += want.length;
      found += Math.max(0, ...x.tables.map((tbl) => {
        const have = new Set(tbl.flat().map(N));
        return want.filter((w) => have.has(w)).length;
      }));
    }
    row.tables = found / Math.max(1, total);
  }
  if (truth.lists?.length) {
    const have = x.lists.flat().map(N);
    const want = truth.lists.flatMap((l) => l.items.map(N));
    row.lists = want.filter((w) => have.some((h) => h === w || h.endsWith(w))).length / want.length;
  }
  if (truth.links?.length) row.links = truth.links.filter((l) => x.links.includes(l.url)).length / truth.links.length;
  return row;
}

const METRICS = ["text", "order", "headings", "levelOK", "tables", "lists", "links"];
const docs = readdirSync(CORPUS).filter((f) => f.endsWith(".pdf")).map((f) => f.slice(0, -4)).sort();
const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;
const rows: { doc: string; side: string; ok: boolean; m: Record<string, number | undefined> }[] = [];
for (const doc of docs) {
  if (only && !only.has(doc)) continue;
  const truth: Truth = JSON.parse(readFileSync(join(CORPUS, doc + ".truth.json"), "utf8"));
  for (const side of SIDES) {
    const file = join(OUT, side, doc + ".md");
    if (!existsSync(file)) {
      rows.push({ doc, side, ok: false, m: {} });
      continue;
    }
    rows.push({ doc, side, ok: true, m: score(truth, parse(readFileSync(file, "utf8"))) });
  }
}
const f = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? "-" : v.toFixed(2));
const lines = [`| doc | side | ${METRICS.join(" | ")} |`, `|---|---|${METRICS.map(() => "---").join("|")}|`];
for (const r of rows) lines.push(`| ${r.doc} | ${r.side} | ${r.ok ? METRICS.map((k) => f(r.m[k])).join(" | ") : "no file |".repeat(METRICS.length).slice(0, -2)} |`);
lines.push("", "| side | files | " + METRICS.join(" | ") + " |", `|---|---|${METRICS.map(() => "---").join("|")}|`);
for (const side of SIDES) {
  const mine = rows.filter((r) => r.side === side);
  const got = mine.filter((r) => r.ok);
  lines.push(`| ${side} | ${got.length}/${mine.length} | ${METRICS.map((k) => f(mean(got.map((r) => r.m[k]).filter((v): v is number => v !== undefined)))).join(" | ")} |`);
}
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "score.md"), lines.join("\n") + "\n");
console.log(lines.slice(-4).join("\n"));
