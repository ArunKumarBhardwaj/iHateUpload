/** Extra scoring for the realistic corpus, layered on ../score.ts without changing it. */
import JSZip from "jszip";

import { readDocx } from "../docx-model";
import { normalise, scoreModel, type ScoreResult } from "../score";
import type { RealTruth } from "./gen";

const chars = (s: string) => [...normalise(s).replace(/\s+/g, "")];

/** F1 of the multiset of non-space characters. For scripts without word spaces (CJK) or with bidi extraction quirks (RTL). */
export function charAccuracy(truthParas: string[], hypParas: string[]): number {
  const t = truthParas.flatMap(chars);
  const h = hypParas.flatMap(chars);
  if (!t.length) return h.length ? 0 : 1;
  const m = new Map<string, number>();
  for (const c of h) m.set(c, (m.get(c) ?? 0) + 1);
  let common = 0;
  for (const c of t) {
    const n = m.get(c) ?? 0;
    if (n > 0) {
      common++;
      m.set(c, n - 1);
    }
  }
  const p = h.length ? common / h.length : 0;
  const r = common / t.length;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

/** Share of truth comments whose words are mostly found in word/comments.xml, over max(truth, found). */
export function commentsScore(truth: string[], found: string[]): number {
  const words = (s: string) => normalise(s).toLowerCase().split(" ").filter(Boolean);
  const used = new Set<number>();
  let ok = 0;
  for (const c of truth) {
    const tw = words(c);
    const i = found.findIndex((f, k) => {
      if (used.has(k)) return false;
      const fw = new Set(words(f));
      return tw.filter((w) => fw.has(w)).length / Math.max(1, tw.length) >= 0.8;
    });
    if (i >= 0) {
      used.add(i);
      ok++;
    }
  }
  return ok / Math.max(truth.length, found.length, 1);
}

async function docxComments(bytes: Uint8Array): Promise<string[]> {
  const z = await JSZip.loadAsync(bytes);
  const f = z.file("word/comments.xml");
  if (!f) return [];
  const xml = await f.async("string");
  return [...xml.matchAll(/<w:comment\b[\s\S]*?<\/w:comment>/g)].map((m) => [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(" "));
}

export async function scoreReal(bytes: Uint8Array, truth: RealTruth): Promise<ScoreResult> {
  const model = await readDocx(bytes);
  const res = scoreModel(truth, model);
  if (truth.charMode) {
    res.features.text = charAccuracy(truth.paragraphs, model.paragraphs.map((p) => p.text));
    // Word order of RTL/CJK text is not comparable word by word; drop the order score for these.
    delete res.features.order;
  }
  if (truth.comments?.length) res.features.comments = commentsScore(truth.comments, await docxComments(bytes));
  const vals = Object.values(res.features);
  res.overall = vals.reduce((a, b) => a + b, 0) / vals.length;
  return res;
}
