import { afterEach, expect, test } from "bun:test";

import { POST } from "@/app/api/ask/route";

import {
  AskError,
  askDirect,
  askViaServer,
  buildGeminiBody,
  callGemini,
  fitDocs,
  hasWords,
  keyStore,
  MODELS,
} from "./gemini";

const ok = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });

type Body = { contents: { role: string; parts: { text: string }[] }[] };
type Call = { url: string; key: string | null; body: Body };
function mockFetch(replies: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      key: new Headers(init.headers).get("x-goog-api-key"),
      body: JSON.parse(String(init.body)),
    });
    const next = replies.shift() ?? new Response("{}", { status: 500 });
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("fitDocs keeps short files whole and shares the rest", () => {
  const { docs, cut } = fitDocs(
    [
      { name: "a.pdf", text: "x".repeat(10) },
      { name: "b.pdf", text: "y".repeat(500) },
      { name: "c.pdf", text: "z".repeat(500) },
    ],
    100,
  );
  expect(docs[0].text.length).toBe(10);
  expect(docs[1].text.length + docs[2].text.length).toBe(90);
  expect(cut).toEqual(["b.pdf", "c.pdf"]);
});

test("the request carries every file and maps assistant turns to model", () => {
  const body = buildGeminiBody(
    [
      { name: "a.pdf", text: "alpha" },
      { name: "b.pdf", text: "beta" },
    ],
    [
      { role: "user", content: "who?" },
      { role: "assistant", content: "A." },
      { role: "user", content: "and then?" },
    ],
  );
  expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
  const first = body.contents[0].parts[0].text;
  expect(first).toContain("=== File: a.pdf ===\nalpha");
  expect(first).toContain("=== File: b.pdf ===\nbeta");
  expect(first).toContain("Question: who?");
  expect(body.contents[2].parts[0].text).toBe("and then?");
  expect(body.systemInstruction.parts[0].text).toContain("Page N");
});

test("own-key mode calls Google directly with the key and the whole chat", async () => {
  const { impl, calls } = mockFetch([ok("Seven.")]);
  const answer = await askDirect(" KEY123 ", [{ name: "a.pdf", text: "t" }], [{ role: "user", content: "q" }], impl);
  expect(answer).toBe("Seven.");
  expect(calls).toHaveLength(1);
  expect(calls[0].url.startsWith("https://generativelanguage.googleapis.com/")).toBe(true);
  expect(calls[0].key).toBe("KEY123");
});

test("falls through models on server errors but stops on a bad key", async () => {
  const a = mockFetch([new Response("{}", { status: 503 }), ok("fine")]);
  expect(await askDirect("k", [{ name: "a", text: "t" }], [{ role: "user", content: "q" }], a.impl)).toBe("fine");
  expect(a.calls.map((c) => c.url)).toEqual([
    expect.stringContaining(MODELS[0]),
    expect.stringContaining(MODELS[1]),
  ]);
  const b = mockFetch([new Response("{}", { status: 403 })]);
  const err = await askDirect("k", [{ name: "a", text: "t" }], [{ role: "user", content: "q" }], b.impl).catch((e) => e);
  expect(err).toBeInstanceOf(AskError);
  expect(err.message).toContain("rejected this key");
  expect(b.calls).toHaveLength(1);
});

test("network failure and quota give plain messages", async () => {
  const net = await askDirect("k", [{ name: "a", text: "t" }], [{ role: "user", content: "q" }], mockFetch([new Error("x")]).impl).catch((e) => e);
  expect(net.message).toContain("Could not reach Google");
  const quota = await askDirect("k", [{ name: "a", text: "t" }], [{ role: "user", content: "q" }], mockFetch([new Response("{}", { status: 429 })]).impl).catch((e) => e);
  expect(quota.message).toContain("out of quota");
});

test("server mode posts docs and messages to /api/ask only", async () => {
  const seen: { url: string; body: { docs: { name: string }[] } }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ answer: "ok" }), { status: 200 });
  }) as unknown as typeof fetch;
  expect(await askViaServer([{ name: "a.pdf", text: "t" }], [{ role: "user", content: "q" }], impl)).toBe("ok");
  expect(seen[0].url).toBe("/api/ask");
  expect(seen[0].body.docs[0].name).toBe("a.pdf");
  const off = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
  const err = await askViaServer([{ name: "a", text: "t" }], [{ role: "user", content: "q" }], off).catch((e) => e);
  expect(err.status).toBe(503);
});

test("key store remembers only when asked, and survives blocked storage", () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  expect(keyStore.load(storage)).toBe("");
  keyStore.save("abc", storage);
  expect(keyStore.load(storage)).toBe("abc");
  keyStore.clear(storage);
  expect(keyStore.load(storage)).toBe("");
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  expect(keyStore.load(blocked)).toBe("");
  expect(() => keyStore.save("x", blocked)).not.toThrow();
});

// --- /api/ask route, Google mocked ---
const realFetch = globalThis.fetch;
const realKey = process.env.GEMINI_API_KEY;
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = realKey;
});
const post = (body: unknown) =>
  POST(new Request("http://x/api/ask", { method: "POST", body: JSON.stringify(body) }));

test("route: multi-turn, multi-file request is forwarded to Google", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  const { impl, calls } = mockFetch([ok("Answer")]);
  globalThis.fetch = impl;
  const res = await post({
    docs: [
      { name: "a.pdf", text: "alpha" },
      { name: "b.pdf", text: "beta" },
    ],
    messages: [
      { role: "user", content: "one?" },
      { role: "assistant", content: "1" },
      { role: "user", content: "two?" },
    ],
  });
  expect(res.status).toBe(200);
  expect((await res.json()).answer).toBe("Answer");
  expect(calls[0].body.contents).toHaveLength(3);
  expect(calls[0].body.contents[0].parts[0].text).toContain("b.pdf");
});

test("route: the older text + question body still works", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = mockFetch([ok("Old")]).impl;
  const res = await post({ text: "hello", question: "hi?" });
  expect((await res.json()).answer).toBe("Old");
});

test("route: rejects files, bad shapes, too many documents, and a missing key", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = mockFetch([]).impl;
  expect((await post({ file: "x", text: "t", question: "q" })).status).toBe(400);
  expect((await post({ docs: [], messages: [{ role: "user", content: "q" }] })).status).toBe(400);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ name: `${i}.pdf`, text: "t" }));
  expect((await post({ docs: eleven, messages: [{ role: "user", content: "q" }] })).status).toBe(400);
  expect((await post({ docs: [{ name: "a", text: "t" }], messages: [{ role: "assistant", content: "q" }] })).status).toBe(400);
  delete process.env.GEMINI_API_KEY;
  expect((await post({ text: "t", question: "q" })).status).toBe(503);
});

test("page markers alone are not text", () => {
  expect(hasWords("\n\n--- Page 1 ---\n  \n\n--- Page 2 ---")).toBe(false);
  expect(hasWords("--- Page 1 ---\nHello")).toBe(true);
});

test("a model that hangs past the time limit falls through to the next one", async () => {
  const urls: string[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    urls.push(String(url));
    if (urls.length === 1) {
      // Never answers until the caller gives up on it.
      return new Promise<Response>((_, reject) =>
        init.signal?.addEventListener("abort", () => reject(new DOMException("timed out", "TimeoutError"))),
      );
    }
    return ok("Fast answer");
  }) as unknown as typeof fetch;
  const result = await callGemini("k", { contents: [] }, impl, { timeoutMs: 50 });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.answer).toBe("Fast answer");
    expect(result.model).toBe(MODELS[1]);
  }
  expect(result.attempts.map((a) => a.status)).toEqual([504, 200]);
});

test("the quick lite model is tried first", () => {
  expect(MODELS[0]).toContain("lite");
});

test("route: says which model answered and how long it took", async () => {
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = mockFetch([ok("Timed")]).impl;
  const res = await post({ docs: [{ name: "a.pdf", text: "alpha" }], messages: [{ role: "user", content: "q?" }] });
  expect(res.status).toBe(200);
  expect(res.headers.get("server-timing")).toMatch(new RegExp(`gemini;desc="${MODELS[0]}";dur=\\d+`));
});
