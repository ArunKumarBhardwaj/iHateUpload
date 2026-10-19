/** Shared by the browser (own-key mode) and our server route: one request shape, one reply parser. */

export type AskDoc = { name: string; text: string };
export type ChatTurn = { role: "user" | "assistant"; content: string };

export const MAX_DOCS = 10;
/** Characters of PDF text in one request, over all files. */
export const TOTAL_CHARS = 120_000;
export const MAX_TURNS = 40;
export const MAX_TURN_CHARS = 4000;

export const MODELS = ["gemini-flash-latest", "gemini-3.5-flash-lite", "gemini-3.6-flash"] as const;

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const SYSTEM =
  "You answer questions about the documents below. Use only what the documents say; " +
  "if the answer is not there, say so. Each document starts with its file name and its " +
  "pages are marked '--- Page N ---'. Name the file and page you used, like (report.pdf, p. 3).";

/** True when extracted text holds more than the page markers. */
export function hasWords(text: string) {
  return text.replace(/--- Page \d+ ---/g, "").trim().length > 0;
}

/** Splits the character budget over the files: short files keep all, long ones share the rest. */
export function fitDocs(docs: AskDoc[], budget = TOTAL_CHARS): { docs: AskDoc[]; cut: string[] } {
  const order = docs.map((d, i) => i).sort((a, b) => docs[a].text.length - docs[b].text.length);
  const limit = new Map<number, number>();
  let left = budget;
  order.forEach((index, rank) => {
    const share = Math.floor(left / (docs.length - rank));
    const take = Math.min(docs[index].text.length, share);
    limit.set(index, take);
    left -= take;
  });
  const cut: string[] = [];
  const out = docs.map((d, i) => {
    const max = limit.get(i) ?? 0;
    if (d.text.length <= max) return d;
    cut.push(d.name);
    return { name: d.name, text: d.text.slice(0, max) };
  });
  return { docs: out, cut };
}

export function buildGeminiBody(docs: AskDoc[], turns: ChatTurn[]) {
  const context = docs.map((d) => `=== File: ${d.name} ===\n${d.text}`).join("\n\n");
  const contents = turns.map((t, i) => ({
    role: t.role === "user" ? "user" : "model",
    parts: [{ text: i === 0 ? `${context}\n\nQuestion: ${t.content}` : t.content }],
  }));
  return { systemInstruction: { parts: [{ text: SYSTEM }] }, contents };
}

type GeminiPayload = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

export function parseAnswer(payload: GeminiPayload) {
  return (
    payload.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

export type GeminiResult = { ok: true; answer: string } | { ok: false; status: number };

/** Tries each model in turn; stops early on a rejected key or an used-up quota. */
export async function callGemini(
  key: string,
  body: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<GeminiResult> {
  let status = 502;
  for (const model of MODELS) {
    let response: Response;
    try {
      response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
    } catch {
      return { ok: false, status: 0 };
    }
    const payload = (await response.json().catch(() => ({}))) as GeminiPayload;
    if (response.ok) {
      const answer = parseAnswer(payload);
      if (answer) return { ok: true, answer };
      status = 502;
      continue;
    }
    status = response.status;
    if (status === 400 || status === 401 || status === 403 || status === 429) break;
  }
  return { ok: false, status };
}

export function messageFor(status: number, ownKey: boolean) {
  if (status === 0) return "Could not reach Google. Check your connection.";
  if (status === 429) {
    return ownKey
      ? "Google says this key is out of quota for now. Try again later."
      : "The free Gemini quota for today is used up. Try again later, or use your own Gemini key.";
  }
  if (status === 400 && ownKey) return "Google rejected the request. Check the key is a valid Gemini API key.";
  if (status === 401 || status === 403) {
    return ownKey ? "Google rejected this key. Check it and try again." : "The server's Gemini key was rejected.";
  }
  return "The model could not answer.";
}

export class AskError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Own-key mode: the browser talks to Google directly. Nothing goes through our server. */
export async function askDirect(
  key: string,
  docs: AskDoc[],
  turns: ChatTurn[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const result = await callGemini(key.trim(), buildGeminiBody(docs, turns), fetchImpl);
  if (!result.ok) throw new AskError(messageFor(result.status, true), result.status);
  return result.answer;
}

/** Default mode: text and chat go to our server, which holds the key. */
export async function askViaServer(
  docs: AskDoc[],
  turns: ChatTurn[],
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchImpl("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ docs, messages: turns }),
    });
  } catch {
    throw new AskError("Could not reach the server. Check your connection.", 0);
  }
  const payload = (await response.json().catch(() => ({}))) as { answer?: string; error?: string };
  if (response.status === 503) {
    throw new AskError("Ask PDF is not set up on this host. Nothing was sent. You can use your own Gemini key instead.", 503);
  }
  if (!response.ok || !payload.answer) {
    throw new AskError(payload.error ?? "The model could not answer.", response.status);
  }
  return payload.answer;
}

const KEY_STORE = "ihateupload.ask.geminiKey";

/** The key lives in this browser only, and only when the person ticks "remember". */
export const keyStore = {
  load(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): string {
    try {
      return storage?.getItem(KEY_STORE) ?? "";
    } catch {
      return "";
    }
  },
  save(key: string, storage: Pick<Storage, "setItem"> | undefined = safeStorage()) {
    try {
      storage?.setItem(KEY_STORE, key);
    } catch {
      /* storage blocked: the key just is not remembered */
    }
  },
  clear(storage: Pick<Storage, "removeItem"> | undefined = safeStorage()) {
    try {
      storage?.removeItem(KEY_STORE);
    } catch {
      /* nothing to clear */
    }
  },
};

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
