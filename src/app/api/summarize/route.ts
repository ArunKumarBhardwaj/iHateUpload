import { NextResponse } from "next/server";

import { callGemini, messageFor, serverTiming } from "@/lib/ask/gemini";
import { buildSummaryBody, PART_CHARS, parseSummary, SUMMARY_LENGTHS, type SummaryLength, type SummaryStage } from "@/lib/summarize/summary";
import { TARGET_LANGUAGES } from "@/lib/translate/languages";

/** Three models at up to 25 s each, plus headroom. */
export const maxDuration = 90;

const STAGES: SummaryStage[] = ["whole", "part", "combine"];

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** One run of page text from a PDF in the browser: { text, stage, length, language }. Never a file. */
export async function POST(request: Request) {
  let body: { text?: unknown; stage?: unknown; length?: unknown; language?: unknown; file?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("Expected JSON.");
  }
  if (body.file !== undefined) return bad("Do not send a file. Text only.");
  if (typeof body.text !== "string" || !body.text.trim()) return bad("text is required.");
  if (body.text.length > PART_CHARS + 2000) return bad("Text is too long.");
  if (typeof body.stage !== "string" || !STAGES.includes(body.stage as SummaryStage)) return bad("Unknown stage.");
  if (!SUMMARY_LENGTHS.some((l) => l.id === body.length)) return bad("Unknown length.");
  if (body.language !== "auto" && !TARGET_LANGUAGES.some((l) => l.code === body.language)) return bad("Unknown language.");

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "Summarize is not configured." }, { status: 503 });

  const call = buildSummaryBody(body.text, { length: body.length as SummaryLength, language: body.language as string }, body.stage as SummaryStage);
  const result = await callGemini(key, call);
  const headers = { "Server-Timing": serverTiming(result.attempts) };
  if (!result.ok) {
    return NextResponse.json({ error: messageFor(result.status, false) }, { status: result.status === 429 ? 429 : 502, headers });
  }
  const summary = parseSummary(result.answer);
  if (!summary) return NextResponse.json({ error: "The model's answer was not a summary." }, { status: 502, headers });
  return NextResponse.json({ summary }, { headers });
}
