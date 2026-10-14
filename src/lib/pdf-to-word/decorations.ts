import { indexAt } from "./links";
import type { Fill, Frag, Line, Rule } from "./lines";

/** How far a line or box may stick out past the text it belongs to, in points. */
const REACH = 3;
/** Cuts closer than this to the end of a piece do not split it. */
const SNAP = 1.5;

type Kind = "underline" | "strike";

const horizontal = (r: Rule) => Math.abs(r.y0 - r.y1) <= 0.6 && r.x1 - r.x0 >= 4;

/** Cut a piece of text at the page positions `from` and `to`, returning the part between them marked. */
function cut(frag: Frag, from: number, to: number, mark: Partial<Frag>): Frag[] {
  const { text } = frag;
  const any = () => true;
  const a = from <= frag.x0 + SNAP ? 0 : indexAt(frag, from, any);
  const b = to >= frag.x1 - SNAP ? text.length : indexAt(frag, to, any);
  if (b <= a) return [frag];
  const per = (frag.x1 - frag.x0) / Math.max(1, text.length);
  const piece = (i: number, j: number, extra: Partial<Frag> = {}): Frag => ({
    ...frag,
    ...extra,
    text: text.slice(i, j),
    x0: i === 0 ? frag.x0 : frag.x0 + per * i,
    x1: j === text.length ? frag.x1 : frag.x0 + per * j,
    tabBefore: i === 0 ? frag.tabBefore : undefined,
  });
  const out: Frag[] = [];
  if (a > 0) out.push(piece(0, a));
  out.push(piece(a, b, mark));
  if (b < text.length) out.push(piece(b, text.length));
  return out;
}

type Hit = { line: Line; frag: Frag };

/** Pieces of text whose x-range the span [x0, x1] overlaps and that pass `fits`; null when the span overshoots them. */
function hitsFor(lines: Line[], x0: number, x1: number, fits: (frag: Frag, line: Line) => boolean): Hit[] | null {
  const hits: Hit[] = [];
  for (const line of lines) {
    if (line.x1 < x0 || line.x0 > x1) continue;
    for (const frag of line.frags) {
      if (frag.y === undefined || !frag.text.trim()) continue;
      if (Math.min(frag.x1, x1) - Math.max(frag.x0, x0) < 1) continue;
      if (fits(frag, line)) hits.push({ line, frag });
    }
  }
  if (!hits.length) return null;
  const left = Math.min(...hits.map((h) => h.frag.x0));
  const right = Math.max(...hits.map((h) => h.frag.x1));
  if (x0 < left - REACH || x1 > right + REACH) return null;
  return hits;
}

function mark(hits: Hit[], x0: number, x1: number, extra: Partial<Frag>) {
  for (const { line, frag } of hits) {
    const at = line.frags.indexOf(frag);
    if (at >= 0) line.frags.splice(at, 1, ...cut(frag, x0, x1, extra));
  }
}

/**
 * Lines drawn under or through text, and boxes painted behind it, are the text's own formatting.
 * They are marked on the pieces of text and the lines are dropped from the rules that tables read.
 * Fills stay where they are: a box that is a highlight may still be a table cell's background.
 */
export function applyDecorations(lines: Line[], rules: Rule[], fills: Fill[] | undefined): Rule[] {
  const kept: Rule[] = [];
  for (const rule of rules) {
    if (!horizontal(rule)) {
      kept.push(rule);
      continue;
    }
    const x0 = Math.min(rule.x0, rule.x1);
    const x1 = Math.max(rule.x0, rule.x1);
    const near = lines.filter((l) => Math.abs(l.baseline - rule.y0) <= l.size * 0.6);
    let used = false;
    for (const kind of ["underline", "strike"] as Kind[]) {
      const hits = hitsFor(near, x0, x1, (frag) => {
        const d = (rule.y0 - (frag.y as number)) / frag.size;
        return kind === "underline" ? d >= 0.03 && d <= 0.3 : d >= -0.45 && d <= -0.15;
      });
      if (!hits) continue;
      mark(hits, x0, x1, { [kind]: true });
      used = true;
      break;
    }
    if (!used) kept.push(rule);
  }
  for (const fill of fills ?? []) {
    const near = lines.filter((l) => l.baseline >= fill.y0 && l.baseline <= fill.y1 + l.size);
    const hits = hitsFor(near, fill.x0, fill.x1, (frag) => {
      const y = frag.y as number;
      const h = fill.y1 - fill.y0;
      return fill.y0 <= y - 0.35 * frag.size && fill.y1 >= y && h <= 1.45 * frag.size && fill.y1 <= y + 0.6 * frag.size;
    });
    if (hits) mark(hits, fill.x0, fill.x1, { highlight: fill.color.toUpperCase() });
  }
  return kept;
}
