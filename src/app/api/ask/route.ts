import { NextResponse } from "next/server";

const MAX_TEXT = 120_000;
const MODELS = [
  "gemini-flash-latest",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
] as const;

type AskBody = {
  text?: unknown;
  question?: unknown;
  file?: unknown;
  blob?: unknown;
};

type GeminiPayload = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { message?: string; status?: string };
};

function answerFrom(payload: GeminiPayload) {
  return (
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

async function generate(
  key: string,
  model: string,
  prompt: string,
): Promise<{ ok: true; answer: string } | { ok: false; status: number }> {
  const gemini = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    },
  );
  const payload = (await gemini.json().catch(() => ({}))) as GeminiPayload;
  if (!gemini.ok) {
    return { ok: false, status: gemini.status };
  }
  const answer = answerFrom(payload);
  if (!answer) {
    return { ok: false, status: 502 };
  }
  return { ok: true, answer };
}

export async function POST(request: Request) {
  let body: AskBody;
  try {
    body = (await request.json()) as AskBody;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }

  if (body.file !== undefined || body.blob !== undefined) {
    return NextResponse.json(
      { error: "Do not send a file. Text only." },
      { status: 400 },
    );
  }

  if (typeof body.text !== "string" || typeof body.question !== "string") {
    return NextResponse.json(
      { error: "text and question are required." },
      { status: 400 },
    );
  }

  const text = body.text.trim();
  const question = body.question.trim();
  if (!text || !question) {
    return NextResponse.json(
      { error: "text and question cannot be empty." },
      { status: 400 },
    );
  }
  if (text.length > MAX_TEXT) {
    return NextResponse.json({ error: "Text is too long." }, { status: 400 });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "Ask PDF is not configured." },
      { status: 503 },
    );
  }

  const prompt = `Document:\n${text}\n\nQuestion: ${question}\n\nAnswer from the document only.`;
  let lastStatus = 502;
  for (const model of MODELS) {
    const result = await generate(key, model, prompt);
    if (result.ok) {
      return NextResponse.json({ answer: result.answer });
    }
    lastStatus = result.status;
    if (lastStatus === 401 || lastStatus === 403 || lastStatus === 429) {
      break;
    }
  }

  if (lastStatus === 429) {
    return NextResponse.json(
      { error: "The free Gemini quota for today is used up. Try again later." },
      { status: 429 },
    );
  }
  if (lastStatus === 401 || lastStatus === 403) {
    return NextResponse.json(
      { error: "The Gemini key was rejected. Check GEMINI_API_KEY on Vercel." },
      { status: 502 },
    );
  }
  return NextResponse.json(
    { error: "The model could not answer." },
    { status: 502 },
  );
}
