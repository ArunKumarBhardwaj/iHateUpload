import { textMarkBox, type PageTextRun } from "@/lib/pdf-edit-runs";
import { newTextMark, type EditMark } from "@/lib/tool-options";

export type FindOptions = { matchCase: boolean; wholeWord: boolean };

export type PageRuns = { pageIndex: number; runs: PageTextRun[] };

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

/**
 * Turns "replace A with B everywhere" into one replace-this-line mark for each
 * line that holds A. The mark removes the old line from the PDF and draws the
 * new one in its place.
 */
export function planFindReplace(
  pages: PageRuns[],
  find: string,
  replace: string,
  options: FindOptions,
): { marks: EditMark[]; matches: number; pagesHit: number[] } {
  const marks: EditMark[] = [];
  const pagesHit: number[] = [];
  let matches = 0;
  if (!find) return { marks, matches, pagesHit };
  for (const page of pages) {
    let hit = false;
    for (const run of page.runs) {
      const count = countMatches(run.text, find, options);
      if (count === 0) continue;
      hit = true;
      matches += count;
      const box = textMarkBox(run);
      // A function replacer keeps "$&" and friends in the replacement literal.
      const text = run.text.replace(pattern(find, options), () => replace);
      marks.push(
        newTextMark(page.pageIndex, box.x, box.y, {
          w: box.w,
          h: box.h,
          text,
          fontSize: box.fontSize,
          cover: true,
        }),
      );
    }
    if (hit) pagesHit.push(page.pageIndex);
  }
  return { marks, matches, pagesHit };
}
