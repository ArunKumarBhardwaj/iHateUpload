import { textMarkBox, type PageTextRun } from "@/lib/pdf-edit-runs";
import { newTextMark, type EditMark } from "@/lib/tool-options";

export type FindOptions = { matchCase: boolean; wholeWord: boolean };

export type PageRuns = { pageIndex: number; runs: PageTextRun[] };

type TextMark = Extract<EditMark, { kind: "text" }>;

/** One place the phrase occurs. */
export type FindMatch = {
  pageIndex: number;
  run: PageTextRun;
  /** The line as it reads now, after any earlier replacement. */
  line: string;
  /** Offset of the match in `line`. */
  start: number;
  /** Which occurrence in the line this is, counting from 0. */
  occurrence: number;
  /** The replace-this-line mark already standing for the line, if any. */
  mark?: TextMark;
};

function pattern(find: string, { matchCase, wholeWord }: FindOptions) {
  const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = wholeWord ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(body, matchCase ? "gu" : "giu");
}

/** How many times the phrase occurs in the text. */
export function countMatches(text: string, find: string, options: FindOptions) {
  if (!find) return 0;
  return text.match(pattern(find, options))?.length ?? 0;
}

/** The mark that already replaces this line, found by where it sits. */
function markFor(marks: EditMark[], pageIndex: number, run: PageTextRun): TextMark | undefined {
  const box = textMarkBox(run);
  return marks.find(
    (m): m is TextMark =>
      m.kind === "text" &&
      m.cover &&
      m.pageIndex === pageIndex &&
      Math.abs(m.x - box.x) < 0.01 &&
      Math.abs(m.y - box.y) < 0.01,
  );
}

/**
 * Every occurrence of the phrase, page by page. A line already replaced is
 * searched as it reads now, so find-next never lands on words that are gone.
 */
export function findMatches(
  pages: PageRuns[],
  marks: EditMark[],
  find: string,
  options: FindOptions,
): FindMatch[] {
  if (!find) return [];
  const out: FindMatch[] = [];
  for (const page of pages) {
    for (const run of page.runs) {
      const mark = markFor(marks, page.pageIndex, run);
      const line = mark ? mark.text : run.text;
      let occurrence = 0;
      for (const hit of line.matchAll(pattern(find, options))) {
        out.push({ pageIndex: page.pageIndex, run, line, start: hit.index ?? 0, occurrence: occurrence++, mark });
      }
    }
  }
  return out;
}

/**
 * Turns "replace A with B" into one replace-this-line mark per line that holds
 * A: the mark removes the old line from the PDF and draws the new one in its
 * place. Pass `only` to change a single match; otherwise every match goes.
 * `marks` in the result are the new or updated ones, not the whole list.
 */
export function planFindReplace(
  pages: PageRuns[],
  marks: EditMark[],
  find: string,
  replace: string,
  options: FindOptions,
  only?: FindMatch,
): { marks: TextMark[]; matches: number; pagesHit: number[] } {
  const out: TextMark[] = [];
  const pagesHit: number[] = [];
  let matches = 0;
  const lines = new Map<PageTextRun, FindMatch[]>();
  for (const m of findMatches(pages, marks, find, options)) {
    if (only && (m.run !== only.run || m.occurrence !== only.occurrence)) continue;
    const list = lines.get(m.run) ?? [];
    list.push(m);
    lines.set(m.run, list);
  }
  for (const [run, hits] of lines) {
    const first = hits[0];
    matches += hits.length;
    if (!pagesHit.includes(first.pageIndex)) pagesHit.push(first.pageIndex);
    let seen = -1;
    // A function replacer keeps "$&" and friends in the replacement literal.
    const text = first.line.replace(pattern(find, options), (hit) => {
      seen++;
      return !only || seen === only.occurrence ? replace : hit;
    });
    if (first.mark) {
      out.push({ ...first.mark, text });
      continue;
    }
    const box = textMarkBox(run);
    const made = newTextMark(first.pageIndex, box.x, box.y, {
      w: box.w,
      h: box.h,
      text,
      fontSize: box.fontSize,
      cover: true,
    }) as TextMark;
    if (run.font) Object.assign(made, run.font);
    out.push(made);
  }
  return { marks: out, matches, pagesHit };
}

/** Puts planned marks into the list, replacing any mark they update. */
export function mergePlanned(marks: EditMark[], planned: EditMark[]): EditMark[] {
  const byId = new Map(planned.map((m) => [m.id, m]));
  const kept = marks.map((m) => byId.get(m.id) ?? m);
  const known = new Set(marks.map((m) => m.id));
  return [...kept, ...planned.filter((m) => !known.has(m.id))];
}
