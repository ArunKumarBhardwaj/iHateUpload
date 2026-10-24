import { NextResponse } from "next/server";

import { callGemini, messageFor, serverTiming } from "@/lib/ask/gemini";
import { BATCH_CHARS, BATCH_ITEMS, buildTranslateBody, parseTranslations } from "@/lib/translate/gemini-translate";
import { TARGET_LANGUAGES } from "@/lib/translate/languages";

/** Three models at up to 25 s each, plus headroom. */
export const maxDuration = 90;

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** One batch of text from a PDF in the browser: { target, texts }. Never a file. */
export async function POST(request: Request) {
  let body: { target?: unknown; texts?: unknown; file?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return bad("Expected JSON.");
  }
  if (body.file !== undefined) return bad("Do not send a file. Text only.");
  if (typeof body.target !== "string" || !TARGET_LANGUAGES.some((l) => l.code === body.target)) return bad("Unknown language.");
  if (!Array.isArray(body.texts) || body.texts.length === 0 || body.texts.length > BATCH_ITEMS) return bad(`Send 1 to ${BATCH_ITEMS} texts.`);
  if (!body.texts.every((t) => typeof t === "string")) return bad("Texts must be strings.");
  const texts = body.texts as string[];
  // One long paragraph may go alone, so allow some room over the batch size.
  if (texts.reduce((n, t) => n + t.length, 0) > BATCH_CHARS * 2) return bad("Text is too long.");

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "Translate is not configured." }, { status: 503 });

  const result = await callGemini(key, buildTranslateBody(body.target, texts));
  const headers = { "Server-Timing": serverTiming(result.attempts) };
  if (!result.ok) {
    return NextResponse.json({ error: messageFor(result.status, false) }, { status: result.status === 429 ? 429 : 502, headers });
  }
  const translations = parseTranslations(result.answer, texts.length);
  if (!translations) return NextResponse.json({ error: "The model's answer did not match the text." }, { status: 502, headers });
  return NextResponse.json({ translations }, { headers });
}
