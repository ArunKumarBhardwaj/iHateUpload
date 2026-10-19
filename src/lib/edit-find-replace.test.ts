import { expect, test } from "bun:test";

import { findMatches, planFindReplace } from "./edit-find-replace";
import type { PageTextRun } from "./pdf-edit-runs";
import { newTextMark } from "./tool-options";

const run = (text: string, y: number, extra?: Partial<PageTextRun>): PageTextRun => ({
  text,
  x: 0.1,
  y,
  w: 0.4,
  h: 0.03,
  ...extra,
});

const pages = [
  { pageIndex: 0, runs: [run("Total due: Acme Corp", 0.2), run("Thanks", 0.5)] },
  { pageIndex: 1, runs: [run("acme corp and ACME CORP", 0.3)] },
];
const loose = { matchCase: false, wholeWord: false };

test("every occurrence is a match, in reading order", () => {
  const found = findMatches(pages, [], "Acme Corp", loose);
  expect(found.map((m) => [m.pageIndex, m.start])).toEqual([
    [0, 11],
    [1, 0],
    [1, 14],
  ]);
});

test("every line holding the phrase becomes a replacement of that line", () => {
  const plan = planFindReplace(pages, [], "Acme Corp", "Globex", loose);
  expect(plan.matches).toBe(3);
  expect(plan.marks).toHaveLength(2);
  expect(plan.marks[0]).toMatchObject({ pageIndex: 0, text: "Total due: Globex", cover: true });
  expect(plan.marks[1]).toMatchObject({ pageIndex: 1, text: "Globex and Globex" });
  expect(plan.pagesHit).toEqual([0, 1]);
});

test("replacing one match leaves the other on the same line", () => {
  const found = findMatches(pages, [], "acme corp", loose);
  const plan = planFindReplace(pages, [], "acme corp", "Globex", loose, found[2]);
  expect(plan.matches).toBe(1);
  expect(plan.marks).toHaveLength(1);
  expect(plan.marks[0].text).toBe("acme corp and Globex");
});

test("a replaced line is searched as it now reads", () => {
  const first = planFindReplace(pages, [], "acme corp", "Globex", loose, findMatches(pages, [], "acme corp", loose)[1]);
  const after = findMatches(pages, first.marks, "acme corp", loose);
  // The first match on page 1 is gone, the one after it is still there.
  expect(after.map((m) => [m.pageIndex, m.start])).toEqual([[0, 11], [1, 11]]);
  const second = planFindReplace(pages, first.marks, "acme corp", "Globex", loose, after[1]);
  expect(second.marks).toHaveLength(1);
  expect(second.marks[0].id).toBe(first.marks[0].id);
  expect(second.marks[0].text).toBe("Globex and Globex");
});

test("the replacement keeps the font of the line it replaces", () => {
  const styled = [
    { pageIndex: 0, runs: [run("Bold Acme", 0.2, { font: { family: "times", bold: true, italic: false } })] },
  ];
  const plan = planFindReplace(styled, [], "Acme", "Globex", loose);
  expect(plan.marks[0]).toMatchObject({ family: "times", bold: true });
});

test("match case and whole word narrow the hits", () => {
  expect(findMatches(pages, [], "Acme Corp", { matchCase: true, wholeWord: false })).toHaveLength(1);
  expect(findMatches(pages, [], "Corp", { matchCase: false, wholeWord: true })).toHaveLength(3);
  expect(findMatches(pages, [], "orp", { matchCase: false, wholeWord: true })).toHaveLength(0);
});

test("regex characters in the phrase are taken literally", () => {
  const plan = planFindReplace([{ pageIndex: 0, runs: [run("cost (USD) 5.00", 0.1)] }], [], "(USD) 5.00", "$5", {
    matchCase: true,
    wholeWord: false,
  });
  expect(plan.marks[0].text).toBe("cost $5");
});

test("an empty phrase plans nothing", () => {
  expect(planFindReplace(pages, [], "", "x", loose).marks).toEqual([]);
  expect(findMatches(pages, [], "", loose)).toEqual([]);
});

test("a hand-added text box is not searched", () => {
  const added = newTextMark(0, 0.1, 0.2, { w: 0.4, h: 0.03, text: "Acme Corp" });
  expect(findMatches([{ pageIndex: 0, runs: [] }], [added], "Acme", loose)).toEqual([]);
});
