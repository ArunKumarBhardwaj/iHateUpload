/**
 * Summarize PDF over the same Gemini path as Ask PDF. The page text goes as
 * text with '--- Page N ---' markers; the summary comes back as JSON with the
 * pages each point came from. Every figure in it is then looked up in the
 * PDF's own text, so a number the model made up is marked, not trusted.
 */
import { targetLanguage } from "@/lib/translate/languages";

export type SummaryLength = "short" | "standard" | "detailed";
export const SUMMARY_LENGTHS: { id: SummaryLength; name: string }[] = [
  { id: "short", name: "Short" },
  { id: "standard", name: "Standard" },
  { id: "detailed", name: "Detailed" },
];

/** "auto" writes in the document's own language; otherwise a code from TARGET_LANGUAGES. */
export type SummaryRequest = { length: SummaryLength; language: string };

/** One request's text. Longer documents are summarized in parts, then the parts are combined. */
export const PART_CHARS = 100_000;
/** Characters one document may send through our server's shared key. Own keys have no cap here. */
export const SERVER_DOC_CHARS = 400_000;

export type SummaryPoint = { text: string; pages: number[] };
export type SummarySection = { heading: string; summary: string; pages: number[] };
export type Summary = { title: string; overview: string; points: SummaryPoint[]; sections: SummarySection[] };

/** Stage "whole": the full text at once. "part": one run of pages. "combine": the part summaries. */
export type SummaryStage = "whole" | "part" | "combine";

const SIZE: Record<SummaryLength, string> = {
  short: "overview: 1 to 2 sentences. points: 3 to 5. sections: an empty list.",
  standard:
    "overview: 2 to 4 sentences. points: 5 to 8. sections: one per main part when the document has 3 or more pages, at most 6; otherwise an empty list.",
  detailed: "overview: 3 to 5 sentences. points: 8 to 15. sections: one per main part, at most 12, each summary 1 to 3 sentences.",
};

function languageLine(language: string) {
  return language === "auto"
    ? "Write in the language the document is written in."
    : `Write in ${targetLanguage(language).name}, whatever language the document is in.`;
}

export function buildSummaryBody(text: string, request: SummaryRequest, stage: SummaryStage = "whole") {
  const source =
    stage === "combine"
      ? "The notes below summarize consecutive parts of one document, each with the pages it came from. Merge them into one summary of the whole document."
      : stage === "part"
        ? "The text below is one part of a longer document. Summarize this part; another step merges the parts."
        : "Summarize the document below for a reader who has not seen it.";
  const system = [
    source,
    "Use only what the text says. Pages are marked '--- Page N ---'.",
    "title: the document's own title, or a short description of it. overview: what the document is, who it is from and to, its purpose and its main outcome.",
    "points: the key facts, decisions, amounts, dates, deadlines and obligations, one sentence each, with the page numbers each one comes from.",
    "sections: the main parts in order, each with a heading, a short summary and its pages.",
    "Copy every number, amount, date, percentage and name exactly as the document writes it. Do not work out new totals. Do not add advice or opinions.",
    languageLine(request.language),
    stage === "part" ? SIZE.detailed : SIZE[request.length],
  ].join(" ");
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          overview: { type: "STRING" },
          points: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: { text: { type: "STRING" }, pages: { type: "ARRAY", items: { type: "INTEGER" } } },
              required: ["text", "pages"],
            },
          },
          sections: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                heading: { type: "STRING" },
                summary: { type: "STRING" },
                pages: { type: "ARRAY", items: { type: "INTEGER" } },
              },
              required: ["heading", "summary", "pages"],
            },
          },
        },
        required: ["title", "overview", "points", "sections"],
      },
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

const pageList = (value: unknown, valid?: Set<number>) =>
  Array.isArray(value)
    ? [...new Set(value.map(Number).filter((n) => Number.isInteger(n) && (!valid || valid.has(n))))].sort((a, b) => a - b)
    : [];

/**
 * The summary, or null when the answer is not one. Pages the text does not
 * have are dropped from the citations, so every "(p. N)" points at a real page.
 */
export function parseSummary(answer: string, validPages?: number[]): Summary | null {
  const clean = answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(clean) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || typeof raw.overview !== "string" || !Array.isArray(raw.points)) return null;
  const valid = validPages ? new Set(validPages) : undefined;
  const points = (raw.points as Record<string, unknown>[])
    .filter((p) => typeof p?.text === "string" && p.text.trim())
    .map((p) => ({ text: (p.text as string).trim(), pages: pageList(p.pages, valid) }));
  const sections = (Array.isArray(raw.sections) ? (raw.sections as Record<string, unknown>[]) : [])
    .filter((s) => typeof s?.heading === "string" && typeof s?.summary === "string" && s.summary.trim())
    .map((s) => ({ heading: (s.heading as string).trim(), summary: (s.summary as string).trim(), pages: pageList(s.pages, valid) }));
  if (!raw.overview.trim() && !points.length) return null;
  return { title: typeof raw.title === "string" ? raw.title.trim() : "", overview: raw.overview.trim(), points, sections };
}

/** Page texts in order, grouped into runs of at most `maxChars` (one long page goes alone). */
export function planParts(pages: { page: number; text: string }[], maxChars = PART_CHARS): { page: number; text: string }[][] {
  const out: { page: number; text: string }[][] = [];
  let current: { page: number; text: string }[] = [];
  let size = 0;
  for (const p of pages) {
    const cost = p.text.length + 20;
    if (current.length && size + cost > maxChars) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(p.text.length > maxChars ? { page: p.page, text: p.text.slice(0, maxChars - 20) } : p);
    size += cost;
  }
  if (current.length) out.push(current);
  return out;
}

export const pagesText = (pages: { page: number; text: string }[]) =>
  pages.map((p) => `--- Page ${p.page} ---\n${p.text}`).join("\n\n");

/** The part summaries as notes for the combine step, each point with its pages. */
export function partsAsNotes(parts: Summary[]): string {
  return parts
    .map((s, i) => {
      const lines = [`Part ${i + 1}: ${s.title}`, s.overview, ...s.points.map((p) => `- ${p.text}${cite(p.pages)}`)];
      for (const sec of s.sections) lines.push(`Section "${sec.heading}"${cite(sec.pages)}: ${sec.summary}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

const NUMBER = /\d(?:[\d.,'  ]*\d)?/g;

/** Digits only, so 4,812.50 / 4.812,50 / 4 812,50 all read as 481250. */
const digits = (token: string) => token.replace(/\D/g, "");

/**
 * Figures in `summary` that the source text never shows. Numbers of one digit
 * are left alone (counts like "3 items" are often the model's own), and a
 * figure counts as found when the PDF shows the same digits, or holds them
 * inside a longer figure (2026 in 2026-10-24).
 */
export function missingFigures(summaryText: string, source: string): string[] {
  const known = new Set((source.match(NUMBER) ?? []).map(digits));
  const all = [...known].join(" ");
  const missing = new Set<string>();
  for (const token of summaryText.match(NUMBER) ?? []) {
    const d = digits(token);
    if (d.length < 2 || known.has(d)) continue;
    // Trailing zeros differ by language and style: 8.5% and 8.50%.
    const trimmed = d.replace(/0+$/, "");
    if ([...known].some((k) => k.replace(/0+$/, "") === trimmed && trimmed.length >= 2)) continue;
    if (all.includes(d)) continue;
    missing.add(token);
  }
  return [...missing];
}

function cite(pages: number[]) {
  if (!pages.length) return "";
  const runs: string[] = [];
  for (let i = 0; i < pages.length; i++) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    runs.push(j > i ? `${pages[i]}–${pages[j]}` : `${pages[i]}`);
    i = j;
  }
  return ` (${pages.length > 1 ? "pp." : "p."} ${runs.join(", ")})`;
}

/** The summary as Markdown, with page citations and any figure not found in the PDF marked. */
export function summaryMarkdown(
  summary: Summary,
  { file, pages, length, source }: { file: string; pages: number; length: SummaryLength; source: string },
): { markdown: string; unchecked: string[] } {
  const unchecked = new Set<string>();
  const mark = (text: string) => {
    const missing = missingFigures(text, source);
    missing.forEach((m) => unchecked.add(m));
    return missing.length ? `${text} ⚠` : text;
  };
  const name = SUMMARY_LENGTHS.find((l) => l.id === length)?.name ?? length;
  const out = [
    `# ${summary.title || file}`,
    "",
    `*${name} summary of ${file}, ${pages} page${pages === 1 ? "" : "s"}. Written by Gemini; check important details against the PDF.*`,
    "",
    mark(summary.overview),
  ];
  if (summary.points.length) {
    out.push("", "## Key points", "");
    for (const p of summary.points) out.push(`- ${mark(p.text)}${cite(p.pages)}`);
  }
  if (summary.sections.length) {
    out.push("", "## Section by section");
    for (const s of summary.sections) out.push("", `### ${s.heading}${cite(s.pages)}`, "", mark(s.summary));
  }
  if (unchecked.size) {
    out.push("", `> ⚠ Not found in the PDF: ${[...unchecked].join(", ")}. Check ${unchecked.size === 1 ? "this figure" : "these figures"} before relying on ${unchecked.size === 1 ? "it" : "them"}.`);
  }
  return { markdown: out.join("\n") + "\n", unchecked: [...unchecked] };
}

/** Keeps only citations of pages that were read. */
function keepPages(summary: Summary, valid: Set<number>): Summary {
  const only = (pages: number[]) => pages.filter((p) => valid.has(p));
  return {
    ...summary,
    points: summary.points.map((p) => ({ ...p, pages: only(p.pages) })),
    sections: summary.sections.map((s) => ({ ...s, pages: only(s.pages) })),
  };
}

/**
 * The whole document in one request when it fits, else each run of pages on
 * its own and then one request that merges the part summaries.
 */
export async function summarizeDocument(
  pages: { page: number; text: string }[],
  request: SummaryRequest,
  call: (text: string, stage: SummaryStage) => Promise<Summary>,
  onProgress: (ratio: number) => void = () => {},
): Promise<{ summary: Summary; parts: number }> {
  const valid = new Set(pages.map((p) => p.page));
  const parts = planParts(pages);
  if (parts.length === 1) {
    const summary = await call(pagesText(parts[0]), "whole");
    onProgress(1);
    return { summary: keepPages(summary, valid), parts: 1 };
  }
  const done: Summary[] = [];
  for (const part of parts) {
    done.push(keepPages(await call(pagesText(part), "part"), valid));
    onProgress(done.length / (parts.length + 1));
  }
  const summary = await call(partsAsNotes(done).slice(0, PART_CHARS), "combine");
  onProgress(1);
  return { summary: keepPages(summary, valid), parts: parts.length };
}
