import { expect, test } from "bun:test";

import { POST } from "@/app/api/summarize/route";

import { summarizeDirect } from "./gemini-summary";
import {
  buildSummaryBody,
  missingFigures,
  pagesText,
  parseSummary,
  planParts,
  summarizeDocument,
  summaryMarkdown,
  type Summary,
} from "./summary";

const answer = (s: object) => JSON.stringify(s);
const sample: Summary = {
  title: "Invoice INV-2041",
  overview: "An invoice from Northwind Supplies to Contoso for $4,812.50, due 2026-11-30.",
  points: [
    { text: "Tax is charged at 8.25%.", pages: [1] },
    { text: "Late payment adds a fee of $95.", pages: [2, 3, 4] },
  ],
  sections: [
    { heading: "Line items", summary: "Three line items for office chairs.", pages: [1] },
    { heading: "Terms", summary: "Payment terms.", pages: [2, 4] },
  ],
};

test("the request asks for JSON with pages, in the length and language chosen", () => {
  const body = buildSummaryBody("--- Page 1 ---\nHello", { length: "short", language: "fr" });
  const system = body.systemInstruction.parts[0].text;
  expect(system).toContain("section summary in French");
  expect(system).toContain("points: 3 to 5");
  expect(system).toContain("exactly as the document writes it");
  expect(body.generationConfig.responseMimeType).toBe("application/json");
  expect(body.generationConfig.responseSchema.required).toEqual(["title", "overview", "points", "sections"]);
  expect(buildSummaryBody("x", { length: "detailed", language: "auto" }).systemInstruction.parts[0].text).toContain(
    "language the document is written in",
  );
  // A part of a long document is always summarized in detail, so the merge has enough to work from.
  expect(buildSummaryBody("x", { length: "short", language: "auto" }, "part").systemInstruction.parts[0].text).toContain("points: 8 to 15");
  // Parts stay in the document's language; only the merge writes the language asked for.
  expect(buildSummaryBody("x", { length: "short", language: "es" }, "part").systemInstruction.parts[0].text).not.toContain("Spanish");
  expect(buildSummaryBody("x", { length: "short", language: "es" }, "combine").systemInstruction.parts[0].text).toContain("in Spanish");
  expect(buildSummaryBody("x", { length: "short", language: "es" }, "combine").systemInstruction.parts[0].text).toContain("say each fact once");
});

test("a reply is parsed, cited pages it does not have are dropped, and junk is refused", () => {
  const parsed = parseSummary("```json\n" + answer({ ...sample, points: [{ text: " A ", pages: [3, 1, 1, 99, "x"] }] }) + "\n```", [1, 2, 3]);
  expect(parsed?.points).toEqual([{ text: "A", pages: [1, 3] }]);
  expect(parsed?.sections[0].heading).toBe("Line items");
  expect(parseSummary("not json")).toBeNull();
  expect(parseSummary(answer({ title: "x", points: [] }))).toBeNull();
  expect(parseSummary(answer({ title: "", overview: "", points: [], sections: [] }))).toBeNull();
});

test("pages are grouped into parts under the size limit, in order", () => {
  const pages = [1, 2, 3, 4].map((page) => ({ page, text: "x".repeat(400) }));
  expect(planParts(pages, 900).map((p) => p.map((q) => q.page))).toEqual([[1, 2], [3, 4]]);
  expect(planParts([{ page: 7, text: "y".repeat(5000) }], 900)[0][0].text.length).toBeLessThan(900);
  expect(pagesText(pages.slice(0, 1))).toStartWith("--- Page 1 ---\n");
});

test("figures the PDF never shows are found, in any number style", () => {
  const source = "Total due $4,812.50 by 2026-11-30. Tax 8.25%. Fee 95.00 USD. 3 chairs.";
  expect(missingFigures("Total 4.812,50 $ on 30 Nov 2026, tax 8,25 %, fee $95, 3 chairs.", source)).toEqual([]);
  expect(missingFigures("A total of $5,207.56 with tax.", source)).toEqual(["5,207.56"]);
  expect(missingFigures("Order 7 items.", source)).toEqual([]);
});

test("the Markdown cites pages, marks figures not in the PDF, and says who wrote it", () => {
  const source = "Invoice INV-2041 total $4,812.50 due 2026-11-30, tax 8.25%, late fee $95.";
  const { markdown, unchecked } = summaryMarkdown(
    { ...sample, points: [...sample.points, { text: "The total with tax is $5,209.53.", pages: [] }] },
    { file: "invoice.pdf", pages: 4, length: "standard", source },
  );
  expect(markdown).toStartWith("# Invoice INV-2041\n");
  expect(markdown).toContain("Standard summary of invoice.pdf, 4 pages. Written by Gemini");
  expect(markdown).toContain("- Tax is charged at 8.25%. (p. 1)");
  expect(markdown).toContain("- Late payment adds a fee of $95. (pp. 2–4)");
  expect(markdown).toContain("- The total with tax is $5,209.53. ⚠\n");
  expect(markdown).toContain("### Line items (p. 1)");
  expect(markdown).toContain("### Terms (pp. 2–4)");
  expect(markdown).toContain("> ⚠ Not found in the PDF: 5,209.53.");
  expect(unchecked).toEqual(["5,209.53"]);
});

test("a short document is one request; a long one is summarized in parts, then merged", async () => {
  const stages: string[] = [];
  const call = async (text: string, stage: string) => {
    stages.push(stage);
    return { ...sample, points: [{ text: `from ${stage}`, pages: [1, 2, 50] }] };
  };
  const short = await summarizeDocument([{ page: 1, text: "hello" }, { page: 2, text: "world" }], { length: "short", language: "auto" }, call);
  expect(stages).toEqual(["whole"]);
  expect(short.summary.points[0].pages).toEqual([1, 2]);

  stages.length = 0;
  const big = Array.from({ length: 6 }, (_, i) => ({ page: i + 1, text: "z".repeat(45_000) }));
  const long = await summarizeDocument(big, { length: "short", language: "auto" }, call);
  expect(stages).toEqual(["part", "part", "part", "combine"]);
  expect(long.parts).toBe(3);
  expect(long.summary.points[0].text).toBe("from combine");
});

test("own-key mode sends the summary request straight to Google", async () => {
  const seen: string[] = [];
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen.push(url);
    expect(JSON.parse(init.body as string).generationConfig.responseMimeType).toBe("application/json");
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: answer(sample) }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const summary = await summarizeDirect("key-123", { text: "--- Page 1 ---\nx", stage: "whole", request: { length: "short", language: "auto" } }, fakeFetch);
  expect(summary.title).toBe("Invoice INV-2041");
  expect(seen[0]).toStartWith("https://generativelanguage.googleapis.com/");
});

test("the server route checks its input and never takes a file", async () => {
  const post = (body: object) => POST(new Request("http://x/api/summarize", { method: "POST", body: JSON.stringify(body) }));
  const ok = { text: "--- Page 1 ---\nHi", stage: "whole", length: "short", language: "auto" };
  expect((await post({ ...ok, file: "JVBERi0" })).status).toBe(400);
  expect((await post({ ...ok, stage: "chat" })).status).toBe(400);
  expect((await post({ ...ok, length: "huge" })).status).toBe(400);
  expect((await post({ ...ok, language: "xx" })).status).toBe(400);
  expect((await post({ ...ok, text: "x".repeat(200_000) })).status).toBe(400);
  const saved = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  expect((await post(ok)).status).toBe(503);
  if (saved) process.env.GEMINI_API_KEY = saved;
});
