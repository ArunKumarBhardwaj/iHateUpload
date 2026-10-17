import { expect, test } from "bun:test";

import { planFindReplace } from "./edit-find-replace";
import type { PageTextRun } from "./pdf-edit-runs";

const run = (text: string, y: number): PageTextRun => ({ text, x: 0.1, y, w: 0.4, h: 0.03 });

const pages = [
  { pageIndex: 0, runs: [run("Total due: Acme Corp", 0.2), run("Thanks", 0.5)] },
  { pageIndex: 1, runs: [run("acme corp and ACME CORP", 0.3)] },
];

test("every line holding the phrase becomes a replacement of that line", () => {
  const plan = planFindReplace(pages, "Acme Corp", "Globex", { matchCase: false, wholeWord: false });
  expect(plan.matches).toBe(3);
  expect(plan.marks).toHaveLength(2);
  expect(plan.marks[0]).toMatchObject({ pageIndex: 0, text: "Total due: Globex", cover: true });
  expect(plan.marks[1]).toMatchObject({ pageIndex: 1, text: "Globex and Globex" });
  expect(plan.pagesHit).toEqual([0, 1]);
});

test("match case and whole word narrow the hits", () => {
  const cased = planFindReplace(pages, "Acme Corp", "X", { matchCase: true, wholeWord: false });
  expect(cased.matches).toBe(1);
  const whole = planFindReplace(pages, "Corp", "Co", { matchCase: false, wholeWord: true });
  expect(whole.matches).toBe(3);
  const partial = planFindReplace(pages, "orp", "X", { matchCase: false, wholeWord: true });
  expect(partial.matches).toBe(0);
});

test("regex characters in the phrase are taken literally", () => {
  const plan = planFindReplace([{ pageIndex: 0, runs: [run("cost (USD) 5.00", 0.1)] }], "(USD) 5.00", "$5", {
    matchCase: true,
    wholeWord: false,
  });
  expect(plan.marks[0].text).toBe("cost $5");
});

test("an empty phrase plans nothing", () => {
  expect(planFindReplace(pages, "", "x", { matchCase: false, wholeWord: false }).marks).toEqual([]);
});
