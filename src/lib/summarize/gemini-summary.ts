/**
 * One summary request, through our server (which holds the key) or straight
 * from the browser to Google with the person's own key.
 */
import { AskError, callGemini, messageFor } from "@/lib/ask/gemini";

import { buildSummaryBody, parseSummary, type Summary, type SummaryRequest, type SummaryStage } from "./summary";

export type SummaryCall = { text: string; stage: SummaryStage; request: SummaryRequest };

/** Own-key mode: nothing goes through our server. */
export async function summarizeDirect(key: string, call: SummaryCall, fetchImpl: typeof fetch = fetch): Promise<Summary> {
  const result = await callGemini(key.trim(), buildSummaryBody(call.text, call.request, call.stage), fetchImpl);
  if (!result.ok) throw new AskError(messageFor(result.status, true), result.status);
  const summary = parseSummary(result.answer);
  if (!summary) throw new AskError("The model's answer was not a summary. Try again.", 502);
  return summary;
}

/** Default mode: the text goes to our server, which forwards it to Gemini. */
export async function summarizeViaServer(call: SummaryCall, fetchImpl: typeof fetch = fetch): Promise<Summary> {
  let response: Response;
  try {
    response = await fetchImpl("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: call.text, stage: call.stage, length: call.request.length, language: call.request.language }),
    });
  } catch {
    throw new AskError("Could not reach the server. Check your connection.", 0);
  }
  const payload = (await response.json().catch(() => ({}))) as { summary?: unknown; error?: string };
  if (response.status === 503) {
    throw new AskError("Summarize is not set up on this host. Nothing was sent. You can use your own Gemini key instead.", 503);
  }
  const summary = response.ok && payload.summary ? parseSummary(JSON.stringify(payload.summary)) : null;
  if (!summary) throw new AskError(payload.error ?? "The model could not summarize this.", response.status);
  return summary;
}
