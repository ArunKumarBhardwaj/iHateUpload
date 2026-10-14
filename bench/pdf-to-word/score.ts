/** Scores a converted .docx against fixture ground truth. Every score is in 0..1. */
import { isMarkerToken, readDocx, type DocxModel, type RunFmt } from "./docx-model";
import type { Seg, Truth, TruthCell } from "./types";

export type Scores = Record<string, number>;
export type ScoreResult = { features: Scores; detail: Record<string, number>; overall: number };

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function normalise(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
const words = (s: string) => normalise(s).split(" ").filter(Boolean);

/** Remove typed list markers at the start of a paragraph (a fake list is judged by the lists score, not here). */
function hypWords(paragraph: string): string[] {
  const w = words(paragraph);
  while (w.length > 1 && isMarkerToken(w[0]) && !/^\d+$/.test(w[0])) w.shift();
  return w;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let cur = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

function multiset(ws: string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const w of ws) m.set(w, (m.get(w) ?? 0) + 1);
  return m;
}
function overlap(a: string[], b: string[]): number {
  const mb = multiset(b);
  let n = 0;
  for (const w of a) {
    const c = mb.get(w) ?? 0;
    if (c > 0) {
      n++;
      mb.set(w, c - 1);
    }
  }
  return n;
}

const LEV_LIMIT = 9000;

/** 1 - character error rate over the words sorted alphabetically, so it ignores order and paragraph splits. */
export function textAccuracy(truthParas: string[], hypParas: string[]): number {
  const t = truthParas.flatMap(words);
  const h = hypParas.flatMap(hypWords);
  if (!t.length) return h.length ? 0 : 1;
  const ts = [...t].sort().join(" ");
  const hs = [...h].sort().join(" ");
  if (ts.length <= LEV_LIMIT && hs.length <= LEV_LIMIT * 1.5) return clamp(1 - levenshtein(ts, hs) / ts.length);
  // Very long documents: character-weighted word multiset F1 (edit distance would be quadratic).
  const mt = multiset(t);
  const mh = multiset(h);
  let common = 0;
  for (const [w, c] of mt) common += Math.min(c, mh.get(w) ?? 0) * w.length;
  const tc = t.reduce((a, w) => a + w.length, 0);
  const hc = h.reduce((a, w) => a + w.length, 0);
  const p = hc ? common / hc : 0;
  const r = tc ? common / tc : 0;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

function lcsLength<T>(a: T[], b: T[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  let cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    [prev, cur] = [cur, prev];
  }
  return prev[b.length];
}

/** LCS of the word sequence divided by the words both sides share, so wrong text does not count as wrong order. */
export function readingOrder(truthParas: string[], hypParas: string[]): number | null {
  const t = truthParas.flatMap(words);
  const h = hypParas.flatMap(hypWords);
  if (t.length > 4000 || t.length < 2) return null;
  const shared = overlap(t, h);
  if (!shared) return 0;
  return clamp(lcsLength(t, h) / shared);
}

/** Share of paragraphs that are exactly right: a truth paragraph is whole in one docx paragraph (not merged, not split). */
export function segmentation(truth: string[], m: DocxModel): number {
  const hyp = m.paragraphs.map((p) => hypWords(p.text).join(" ")).filter(Boolean);
  const pool = multiset(hyp);
  let ok = 0;
  for (const t of truth) {
    const k = words(t).join(" ");
    const c = pool.get(k) ?? 0;
    if (c > 0) {
      ok++;
      pool.set(k, c - 1);
    }
  }
  return clamp(ok / Math.max(truth.length, hyp.length, 1));
}

function headings(truth: NonNullable<Truth["headings"]>, m: DocxModel): number {
  const hyp = m.paragraphs.filter((p) => p.headingLevel > 0 && p.text);
  let score = 0;
  const used = new Set<number>();
  for (const th of truth) {
    const tw = words(th.text);
    let best = -1;
    let bestSim = 0;
    hyp.forEach((p, i) => {
      if (used.has(i)) return;
      const hw = hypWords(p.text);
      const sim = tw.length ? overlap(tw, hw) / Math.max(tw.length, hw.length) : 0;
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    if (best >= 0 && bestSim >= 0.8) {
      used.add(best);
      score += hyp[best].headingLevel === th.level ? 1 : 0.5;
    }
  }
  return clamp(score / Math.max(truth.length, hyp.length));
}

function lists(truth: NonNullable<Truth["lists"]>, m: DocxModel): number {
  const items = truth.flatMap((l) => l.items.map((text) => ({ text: normalise(text), type: l.type })));
  const hypItems = m.paragraphs.filter((p) => p.list || p.literalMarker);
  let score = 0;
  const used = new Set<number>();
  for (const it of items) {
    // Full credit: a real Word list item of the right type. A quarter: the item is its own paragraph
    // (typed marker or none) but is not a real list, so Word cannot renumber or re-indent it.
    const idx = m.paragraphs.findIndex((p, i) => !used.has(i) && hypWords(p.text).join(" ") === words(it.text).join(" "));
    if (idx < 0) continue;
    used.add(idx);
    const p = m.paragraphs[idx];
    score += p.list ? (p.list.type === it.type ? 1 : 0.5) : 0.25;
  }
  return clamp(score / Math.max(items.length, hypItems.length));
}

function truthGrid(rows: TruthCell[][]): ({ text: string; rs: number; cs: number; shaded: boolean } | null)[][] {
  const grid: ({ text: string; rs: number; cs: number; shaded: boolean } | null)[][] = [];
  rows.forEach((row, r) => {
    grid[r] ??= [];
    let c = 0;
    for (const cell of row) {
      while (grid[r][c] !== undefined) c++;
      for (let dr = 0; dr < (cell.rs ?? 1); dr++) {
        grid[r + dr] ??= [];
        for (let dc = 0; dc < (cell.cs ?? 1); dc++) grid[r + dr][c + dc] = dr === 0 && dc === 0 ? { text: normalise(cell.text), rs: cell.rs ?? 1, cs: cell.cs ?? 1, shaded: !!cell.shaded } : null;
      }
      c += cell.cs ?? 1;
    }
  });
  return grid;
}

function tables(truth: NonNullable<Truth["tables"]>, m: DocxModel): { grid: number; merges: number | null; shading: number | null } {
  // Only top-level-ish tables matter; use all and match each truth table to its most similar docx table.
  // Candidates: each table, and runs of consecutive tables with the same column count glued together,
  // so a table that a converter split at page breaks can still be matched (the split is penalised below).
  const raw = m.tables.map((t) => t.rows);
  const hyp: { from: number; to: number; rows: DocxModel["tables"][number]["rows"]; text: string[] }[] = [];
  for (let i = 0; i < raw.length; i++) {
    let rows = raw[i];
    for (let j = i; j < raw.length; j++) {
      if (j > i) {
        if ((raw[j][0]?.length ?? 0) !== (raw[i][0]?.length ?? -1)) break;
        rows = [...rows, ...raw[j]];
      }
      hyp.push({ from: i, to: j, rows, text: words(rows.flat().map((c) => c?.text ?? "").join(" ")) });
    }
  }
  const grids: number[] = [];
  const merges: number[] = [];
  const shades: number[] = [];
  const used = new Set<number>();
  for (const tt of truth) {
    const tg = truthGrid(tt.rows);
    const ttext = words(tt.rows.flat().map((c) => c.text).join(" "));
    let best = -1;
    let bestSim = 0;
    hyp.forEach((h, i) => {
      for (let k = h.from; k <= h.to; k++) if (used.has(k)) return;
      const sim = overlap(ttext, h.text) / Math.max(ttext.length, h.text.length, 1);
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    const truthCells: { r: number; c: number; cell: NonNullable<(typeof tg)[number][number]> }[] = [];
    tg.forEach((row, r) => row.forEach((cell, c) => cell && truthCells.push({ r, c, cell })));
    const tMerge = new Set(truthCells.filter((x) => x.cell.rs > 1 || x.cell.cs > 1).map((x) => `${x.r},${x.c},${x.cell.rs},${x.cell.cs}`));
    const tShade = new Set(truthCells.filter((x) => x.cell.shaded).map((x) => `${x.r},${x.c}`));
    if (best < 0 || bestSim < 0.3) {
      grids.push(0);
      if (tMerge.size) merges.push(0);
      if (tShade.size) shades.push(0);
      continue;
    }
    for (let k = hyp[best].from; k <= hyp[best].to; k++) used.add(k);
    const hr = hyp[best].rows;
    let ok = 0;
    const hMerge = new Set<string>();
    const hShade = new Set<string>();
    hr.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) return;
      if (cell.rs > 1 || cell.cs > 1) hMerge.add(`${r},${c},${cell.rs},${cell.cs}`);
      if (cell.shaded) hShade.add(`${r},${c}`);
    }));
    for (const x of truthCells) if (normalise(hr[x.r]?.[x.c]?.text ?? "\u0000") === x.cell.text) ok++;
    // Rows/columns that the converter added or lost are penalised through the denominator.
    const hypCellCount = hr.flat().filter(Boolean).length;
    grids.push(ok / Math.max(truthCells.length, hypCellCount));
    const f1 = (a: Set<string>, b: Set<string>) => {
      let tp = 0;
      for (const k of a) if (b.has(k)) tp++;
      const p = b.size ? tp / b.size : 0;
      const r = a.size ? tp / a.size : 0;
      return p + r ? (2 * p * r) / (p + r) : 0;
    };
    if (tMerge.size) merges.push(f1(tMerge, hMerge));
    if (tShade.size) shades.push(f1(tShade, hShade));
  }
  // Extra tables the converter invented count against the grid score.
  const extra = Math.max(0, raw.length - truth.length);
  const grid = mean(grids) * (truth.length / (truth.length + extra));
  return { grid: clamp(grid), merges: merges.length ? mean(merges) : null, shading: shades.length ? mean(shades) : null };
}

type Attr = "b" | "i" | "u" | "s" | "sup" | "sub" | "hl";
const BASE_SIZE = 12;
const ATTRS: Attr[] = ["b", "i", "u", "s", "sup", "sub", "hl"];

function runFormatting(truth: Seg[][], m: DocxModel): number {
  // Character stream (spaces removed) with the format of each character.
  let flat = "";
  const fmts: RunFmt[] = [];
  for (const p of m.paragraphs) {
    for (const r of p.runs) {
      for (const ch of normalise(r.text)) {
        if (ch === " ") continue;
        flat += ch;
        fmts.push(r.fmt);
      }
    }
    flat += "\u0001";
    fmts.push(r0);
  }
  let cursor = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  const strip = (s: string) => normalise(s).replace(/ /g, "");
  for (const para of truth) {
    const whole = para.map((s) => strip(s.text)).join("");
    let base = flat.indexOf(whole, cursor);
    const wholeFound = base >= 0;
    let off = 0;
    for (const seg of para) {
      const t = strip(seg.text);
      if (!t) continue;
      let at = -1;
      if (wholeFound) at = base + off;
      else {
        at = flat.indexOf(t, cursor);
        base = -1;
      }
      off += t.length;
      let pred: RunFmt | null = null;
      if (at >= 0) {
        const cs = fmts.slice(at, at + t.length);
        const vote = (f: (x: RunFmt) => boolean) => cs.filter(f).length * 2 >= cs.length;
        pred = {
          b: vote((x) => x.b), i: vote((x) => x.i), u: vote((x) => x.u), s: vote((x) => x.s), sup: vote((x) => x.sup), sub: vote((x) => x.sub), hl: vote((x) => x.hl),
          color: cs[0].color, size: cs[0].size, font: cs[0].font,
        };
        cursor = at + t.length;
      }
      for (const a of ATTRS) {
        const want = !!seg[a];
        const got = pred ? pred[a] : false;
        if (want && got) tp++;
        else if (want && !got) fn++;
        else if (!want && got) fp++;
      }
      // Colour and size join the same pool as events: black and 12 pt are the defaults, so only a
      // departure from them (wanted or invented) counts, and plain text cannot dilute the score.
      const wantColor = (seg.color ?? "000000") !== "000000";
      const gotColor = pred && pred.color !== "000000";
      if (wantColor) {
        if (pred && pred.color === seg.color) tp++;
        else {
          fn++;
          if (gotColor) fp++;
        }
      } else if (gotColor) fp++;
      if (seg.size !== undefined) {
        const wantSize = seg.size !== BASE_SIZE;
        const gotSize = pred && Math.abs(pred.size - BASE_SIZE) > 0.75;
        const match = pred && Math.abs(pred.size - seg.size) <= 0.75;
        if (wantSize) {
          if (match) tp++;
          else {
            fn++;
            if (gotSize) fp++;
          }
        } else if (!match) fp++;
      }
    }
  }
  const p = tp + fp ? tp / (tp + fp) : 0;
  const r = tp + fn ? tp / (tp + fn) : 0;
  const f1 = p + r ? (2 * p * r) / (p + r) : tp + fn === 0 ? 1 : 0;
  return f1;
}
const r0: RunFmt = { b: false, i: false, u: false, s: false, sup: false, sub: false, hl: false, color: "000000", size: 11, font: "" };

function images(truth: NonNullable<Truth["images"]>, m: DocxModel): number {
  const count = Math.min(truth.count, m.images) / Math.max(truth.count, m.images, 1);
  // Order: the Figure label that follows each picture, in document order.
  const labels: string[] = [];
  for (let i = 0; i < m.stream.length; i++) {
    if (m.stream[i].t !== "image") continue;
    let following = "";
    for (let j = i + 1; j < m.stream.length && m.stream[j].t !== "image"; j++) {
      const it = m.stream[j];
      if (it.t === "text") following += " " + it.text;
    }
    const lab = /Figure (\d+)/.exec(following);
    if (lab) labels.push(lab[1]);
  }
  const order = truth.labels.length ? lcsLength(truth.labels, labels) / truth.labels.length : 1;
  return 0.5 * count + 0.5 * order;
}

function links(truth: NonNullable<Truth["links"]>, m: DocxModel): number {
  const used = new Set<number>();
  let score = 0;
  for (const tl of truth) {
    const internal = tl.url.startsWith("#");
    let best = 0;
    let bi = -1;
    m.links.forEach((h, i) => {
      if (used.has(i)) return;
      const urlOk = internal ? h.url.startsWith("#") : h.url === tl.url;
      if (!urlOk) return;
      const s = normalise(h.text).toLowerCase() === normalise(tl.text).toLowerCase() ? 1 : 0.5;
      if (s > best) {
        best = s;
        bi = i;
      }
    });
    if (bi >= 0) used.add(bi);
    score += best;
  }
  return clamp(score / Math.max(truth.length, m.links.length));
}

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function fonts(truth: string[], m: DocxModel): number {
  const have = m.fontNames.map(key);
  const names = mean(truth.map((f) => (have.some((h) => h.includes(key(f)) || key(f).includes(h)) ? 1 : 0)));
  return 0.5 * names + 0.5 * (m.embeddedFonts > 0 ? 1 : 0);
}

function recall(truthText: string, hypText: string): number {
  const t = words(truthText);
  return t.length ? overlap(t, words(hypText)) / t.length : 1;
}

function footnotes(truth: string[], m: DocxModel): number {
  let ok = 0;
  const used = new Set<number>();
  for (const f of truth) {
    const i = m.footnotes.findIndex((h, k) => !used.has(k) && recall(f, h) >= 0.8);
    if (i >= 0) {
      used.add(i);
      ok++;
    }
  }
  return ok / Math.max(truth.length, m.footnotes.length);
}

function formFields(truth: NonNullable<Truth["formFields"]>, m: DocxModel): number {
  const t = { text: truth.filter((f) => f.type === "text").length, checkbox: truth.filter((f) => f.type === "checkbox").length };
  const num = Math.min(t.text, m.formFields.text) + Math.min(t.checkbox, m.formFields.checkbox);
  const den = Math.max(t.text, m.formFields.text) + Math.max(t.checkbox, m.formFields.checkbox);
  return den ? num / den : 1;
}

export function scoreModel(truth: Truth, m: DocxModel): ScoreResult {
  const features: Scores = {};
  const detail: Record<string, number> = {};
  const hypParas = m.paragraphs.map((p) => p.text);
  features.text = textAccuracy(truth.paragraphs, hypParas);
  if (truth.order) {
    const o = readingOrder(truth.paragraphs, hypParas);
    if (o !== null) features.order = o;
  }
  // Editability: share of matched words that sit in flowing paragraphs, not text boxes.
  const tw = truth.paragraphs.flatMap(words);
  const all = overlap(tw, m.paragraphs.flatMap((p) => hypWords(p.text)));
  const flow = overlap(tw, m.paragraphs.filter((p) => !p.inTextbox).flatMap((p) => hypWords(p.text)));
  features.editability = all ? flow / all : 0;
  if (truth.segmentation) features.paragraphs = segmentation(truth.paragraphs, m);
  if (truth.headings?.length) features.headings = headings(truth.headings, m);
  if (truth.lists?.length) features.lists = lists(truth.lists, m);
  if (truth.tables?.length) {
    const t = tables(truth.tables, m);
    detail["tables.grid"] = t.grid;
    if (t.merges !== null) detail["tables.merges"] = t.merges;
    if (t.shading !== null) detail["tables.shading"] = t.shading;
    features.tables = mean([t.grid, ...(t.merges !== null ? [t.merges] : []), ...(t.shading !== null ? [t.shading] : [])]);
  }
  if (truth.runs?.length) features.runs = runFormatting(truth.runs, m);
  if (truth.images) features.images = images(truth.images, m);
  if (truth.vectors) {
    const n = m.shapes + m.images;
    features.vectors = Math.min(truth.vectors, n) / Math.max(truth.vectors, n, 1);
  }
  if (truth.links?.length) features.links = links(truth.links, m);
  if (truth.columns) features.columns = m.columns === truth.columns ? 1 : 0;
  if (truth.fonts?.length) features.fonts = fonts(truth.fonts, m);
  if (truth.header !== undefined || truth.footer !== undefined) {
    const parts: number[] = [];
    if (truth.header) parts.push(recall(truth.header, m.headerText));
    if (truth.footer) parts.push(recall(truth.footer, m.footerText));
    if (truth.pageNumbers) parts.push(m.pageField ? 1 : 0);
    features.headerFooter = mean(parts);
  }
  if (truth.footnotes?.length) features.footnotes = footnotes(truth.footnotes, m);
  if (truth.formFields?.length) features.forms = formFields(truth.formFields, m);
  for (const k of Object.keys(features)) features[k] = clamp(features[k]);
  return { features, detail, overall: mean(Object.values(features)) };
}

export async function scoreDocx(bytes: Uint8Array | ArrayBuffer, truth: Truth): Promise<ScoreResult> {
  return scoreModel(truth, await readDocx(bytes));
}
