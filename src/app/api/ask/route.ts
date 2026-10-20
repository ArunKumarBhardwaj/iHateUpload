import { NextResponse } from "next/server";

import {
  buildGeminiBody,
  callGemini,
  MAX_DOCS,
  MAX_TURN_CHARS,
  MAX_TURNS,
  messageFor,
  serverTiming,
  TOTAL_CHARS,
  type AskDoc,
  type ChatTurn,
} from "@/lib/ask/gemini";

type AskBody = {
  text?: unknown;
  question?: unknown;
  docs?: unknown;
  messages?: unknown;
  file?: unknown;
  blob?: unknown;
};

/** Three models at up to 25 s each, plus headroom. */
export const maxDuration = 90;

function bad(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

/** Accepts the chat shape (docs + messages) and the older single question. */
function readInput(body: AskBody): { docs: AskDoc[]; turns: ChatTurn[] } | string {
  if (body.docs !== undefined || body.messages !== undefined) {
    if (!Array.isArray(body.docs) || !Array.isArray(body.messages)) return "docs and messages must be lists.";
    if (body.docs.length === 0 || body.docs.length > MAX_DOCS) return `Send 1 to ${MAX_DOCS} documents.`;
    const docs: AskDoc[] = [];
    for (const d of body.docs as Record<string, unknown>[]) {
      if (typeof d?.name !== "string" || typeof d?.text !== "string" || !d.text.trim()) {
        return "Each document needs a name and text.";
      }
      docs.push({ name: d.name.slice(0, 200), text: d.text.trim() });
    }
    if (docs.reduce((n, d) => n + d.text.length, 0) > TOTAL_CHARS) return "Text is too long.";
    const msgs = body.messages as Record<string, unknown>[];
    if (msgs.length === 0 || msgs.length > MAX_TURNS) return "Too many messages.";
    const turns: ChatTurn[] = [];
    for (const [i, m] of msgs.entries()) {
      const role = m?.role;
      if ((role !== "user" && role !== "assistant") || typeof m?.content !== "string" || !m.content.trim()) {
        return "Each message needs a role and text.";
      }
      if (m.content.length > MAX_TURN_CHARS * (role === "assistant" ? 4 : 1)) return "A message is too long.";
      if (role !== (i % 2 === 0 ? "user" : "assistant")) return "Messages must alternate, starting with the user.";
      turns.push({ role, content: m.content.trim() });
    }
    if (turns[turns.length - 1].role !== "user") return "The last message must be a question.";
    return { docs, turns };
  }
  if (typeof body.text !== "string" || typeof body.question !== "string") {
    return "text and question are required.";
  }
  const text = body.text.trim();
  const question = body.question.trim();
  if (!text || !question) return "text and question cannot be empty.";
  if (text.length > TOTAL_CHARS) return "Text is too long.";
  return { docs: [{ name: "document.pdf", text }], turns: [{ role: "user", content: question }] };
}

export async function POST(request: Request) {
  let body: AskBody;
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return bad("Expected JSON.");
  }
  if (body.file !== undefined || body.blob !== undefined) return bad("Do not send a file. Text only.");
  const input = readInput(body);
  if (typeof input === "string") return bad(input);

  const key = process.env.GEMINI_API_KEY;
  if (!key) return NextResponse.json({ error: "Ask PDF is not configured." }, { status: 503 });

  const result = await callGemini(key, buildGeminiBody(input.docs, input.turns));
  const headers = { "Server-Timing": serverTiming(result.attempts) };
  if (result.ok) return NextResponse.json({ answer: result.answer }, { headers });
  const status = result.status === 429 ? 429 : 502;
  return NextResponse.json({ error: messageFor(result.status, false) }, { status, headers });
}
