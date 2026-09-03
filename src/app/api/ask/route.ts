import { NextResponse } from "next/server";

const MAX_TEXT = 120_000;

type AskBody = {
  text?: unknown;
  question?: unknown;
  file?: unknown;
  blob?: unknown;
};

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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
  const gemini = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: `Document:\n${text}\n\nQuestion: ${question}\n\nAnswer from the document only.`,
            },
          ],
        },
      ],
    }),
  });

  if (!gemini.ok) {
    return NextResponse.json(
      { error: "The model could not answer." },
      { status: 502 },
    );
  }

  const payload = (await gemini.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const answer =
    payload.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? "")
      .join("")
      .trim() ?? "";

  if (!answer) {
    return NextResponse.json(
      { error: "The model returned an empty answer." },
      { status: 502 },
    );
  }

  return NextResponse.json({ answer });
}
