/**
 * Translate PDF over the same Gemini path as Ask PDF: our server holds the key
 * by default, or the browser calls Google with the person's own key. Texts go
 * as a JSON list and must come back as a list of the same length, in order.
 */
import { AskError, callGemini, messageFor } from "@/lib/ask/gemini";

import { targetLanguage } from "./languages";

/** Characters of source text in one request. */
export const BATCH_CHARS = 6000;
/** Strings in one request, so the model keeps count. */
export const BATCH_ITEMS = 120;
/** Characters one document may send through our server's shared key. Own keys have no cap here. */
export const SERVER_DOC_CHARS = 80_000;

/** Index groups, in order, each under `maxChars` (one long string goes alone). */
export function batchTexts(texts: string[], maxChars = BATCH_CHARS, maxItems = BATCH_ITEMS): number[][] {
  const out: number[][] = [];
  let current: number[] = [];
  let size = 0;
  texts.forEach((text, i) => {
    if (current.length && (size + text.length > maxChars || current.length >= maxItems)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(i);
    size += text.length;
  });
  if (current.length) out.push(current);
  return out;
}

export function buildTranslateBody(target: string, texts: string[]) {
  const { name } = targetLanguage(target);
  const system =
    `Translate each string in the JSON list into ${name}. Reply with a JSON list of strings of exactly the same ` +
    "length and order, one translation per string. Translate every string fully, including headings, titles, " +
    "labels, job titles and short phrases. Leave unchanged only names of people, places and companies, numbers, " +
    "dates, codes and IDs, email and web addresses, and any list marker (•, 1., a)) at the start. Write amounts " +
    `exactly as in the source, with the currency symbol in the same place. If a string is already in ${name}, ` +
    "return it as it is. Do not merge, split, explain or add notes.";
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: JSON.stringify(texts) }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: { type: "ARRAY", items: { type: "STRING" } },
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

/** The list of translations, or null when the answer is not a list of `n` strings. */
export function parseTranslations(answer: string, n: number): string[] | null {
  const clean = answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const list = JSON.parse(clean) as unknown;
    if (!Array.isArray(list) || list.length !== n || !list.every((s) => typeof s === "string")) return null;
    return list as string[];
  } catch {
    return null;
  }
}

/** Own-key mode: the browser asks Google directly; nothing goes through our server. */
export async function translateDirect(key: string, target: string, texts: string[], fetchImpl: typeof fetch = fetch): Promise<string[]> {
  const result = await callGemini(key.trim(), buildTranslateBody(target, texts), fetchImpl);
  if (!result.ok) throw new AskError(messageFor(result.status, true), result.status);
  const list = parseTranslations(result.answer, texts.length);
  if (!list) throw new AskError("The model's answer did not match the text. Try again.", 502);
  return list;
}

/** Default mode: the texts go to our server, which holds the key. */
export async function translateViaServer(target: string, texts: string[], fetchImpl: typeof fetch = fetch): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchImpl("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target, texts }),
    });
  } catch {
    throw new AskError("Could not reach the server. Check your connection.", 0);
  }
  const payload = (await response.json().catch(() => ({}))) as { translations?: unknown; error?: string };
  if (response.status === 503) {
    throw new AskError("Translate is not set up on this host. Nothing was sent. You can use your own Gemini key instead.", 503);
  }
  const list = Array.isArray(payload.translations) ? (payload.translations as unknown[]) : null;
  if (!response.ok || !list || list.length !== texts.length || !list.every((s) => typeof s === "string")) {
    throw new AskError(payload.error ?? "The model could not translate this.", response.status);
  }
  return list as string[];
}
