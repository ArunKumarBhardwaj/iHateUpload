"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Eye, EyeOff, FileText, Loader2, Plus, RotateCcw, Send, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  AskError,
  askDirect,
  askViaServer,
  fitDocs,
  hasWords,
  keyStore,
  MAX_DOCS,
  type AskDoc,
  type ChatTurn,
} from "@/lib/ask/gemini";
import type { FileItem } from "@/lib/job";
import { extractPdfText } from "@/lib/pdf-text";
import { formatBytes } from "@/lib/utils";

type Mode = "server" | "own";
type Extracted = { state: "reading" } | { state: "ready"; text: string } | { state: "failed"; message: string };

const SUGGESTIONS = [
  "What is this document about?",
  "Summarize the key points.",
  "List names, dates, and amounts.",
  "What action is requested?",
];

export const ASK_NOTICE_SERVER =
  "Your PDFs stay in this tab. Their extracted text and your chat are sent to our server, which forwards them to Google Gemini to get an answer. We do not store them.";
export const ASK_NOTICE_OWN =
  "Your PDFs stay in this tab. Their extracted text and your chat go straight from this browser to Google Gemini with your key. Our server never sees them or the key.";

export function AskChat({
  files,
  onFiles,
  onAddMore,
}: {
  files: FileItem[];
  onFiles: (next: FileItem[]) => void;
  onAddMore: () => void;
}) {
  const started = useRef(new Set<string>());
  const [extracted, setExtracted] = useState<Record<string, Extracted>>({});
  const [mode, setMode] = useState<Mode>("server");
  const [key, setKey] = useState("");
  const [remember, setRemember] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // A saved key is read once, after hydration, so the first render matches the server's.
  useEffect(() => {
    const saved = keyStore.load();
    if (saved) {
      /* eslint-disable react-hooks/set-state-in-effect -- browser-only storage */
      setKey(saved);
      setRemember(true);
      setMode("own");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, []);

  // Read each PDF's text once, as it is added.
  useEffect(() => {
    for (const item of files) {
      if (started.current.has(item.id)) continue;
      started.current.add(item.id);
      extractPdfText(item.file).then(
        (text) =>
          setExtracted((m) => ({
            ...m,
            [item.id]: hasWords(text)
              ? { state: "ready", text }
              : { state: "failed", message: "No selectable text. Run OCR PDF first." },
          })),
        (e: unknown) =>
          setExtracted((m) => ({
            ...m,
            [item.id]: { state: "failed", message: e instanceof Error ? e.message : "This PDF could not be read." },
          })),
      );
    }
  }, [files]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [turns, busy]);

  const status = files.map((f) => ({ item: f, info: extracted[f.id] ?? ({ state: "reading" } as Extracted) }));
  const docs: AskDoc[] = status.flatMap(({ item, info }) =>
    info.state === "ready" ? [{ name: item.name, text: info.text }] : [],
  );
  const reading = status.some((s) => s.info.state === "reading");
  const fit = fitDocs(docs);
  const keyOk = mode === "server" || key.trim().length > 10;
  const canSend = !busy && !reading && docs.length > 0 && draft.trim().length > 0 && keyOk;

  async function send(text: string) {
      const next: ChatTurn[] = [...turns, { role: "user", content: text.trim() }];
      setTurns(next);
      setDraft("");
      setError("");
      setBusy(true);
      try {
        if (mode === "own") {
          if (remember) keyStore.save(key.trim());
          else keyStore.clear();
        }
        const answer =
          mode === "own" ? await askDirect(key, fit.docs, next) : await askViaServer(fit.docs, next);
        setTurns([...next, { role: "assistant", content: answer }]);
      } catch (e) {
        setError(e instanceof AskError || e instanceof Error ? e.message : "The model could not answer.");
        setTurns(turns);
        setDraft(text);
      } finally {
        setBusy(false);
      }
  }

  function download() {
    const body = turns.map((t) => `${t.role === "user" ? "You" : "Gemini"}: ${t.content}`).join("\n\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "ask-pdf-chat.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4" data-testid="ask-chat">
      <ul className="space-y-1.5" aria-label="PDFs in this chat">
        {status.map(({ item, info }) => (
          <li key={item.id} className="flex items-center gap-3 rounded-xl border border-ink/10 bg-secondary px-3 py-2">
            <FileText className="size-4 shrink-0 text-signal" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={item.name}>
              {item.name}
            </span>
            <span className="text-xs text-muted-foreground">
              {info.state === "reading" ? (
                <Loader2 className="inline size-3 animate-spin" />
              ) : info.state === "failed" ? (
                <span className="text-destructive">{info.message}</span>
              ) : fit.cut.includes(item.name) ? (
                "Start of the file only"
              ) : (
                formatBytes(item.size)
              )}
            </span>
            <button
              type="button"
              aria-label={`Remove ${item.name}`}
              className="text-muted-foreground hover:text-ink"
              onClick={() => {
                onFiles(files.filter((f) => f.id !== item.id));
                setTurns([]);
              }}
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
        {files.length < MAX_DOCS ? (
          <li>
            <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" onClick={onAddMore}>
              <Plus /> Add a PDF ({files.length}/{MAX_DOCS})
            </Button>
          </li>
        ) : null}
      </ul>

      <fieldset className="space-y-2 rounded-xl border border-ink/10 p-3">
        <legend className="px-1 text-sm font-medium text-ink">Who answers</legend>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" className="h-10 sm:h-7" variant={mode === "server" ? "default" : "outline"} onClick={() => setMode("server")}>
            Our server (no key)
          </Button>
          <Button type="button" size="sm" className="h-10 sm:h-7" variant={mode === "own" ? "default" : "outline"} onClick={() => setMode("own")}>
            My own Gemini key
          </Button>
        </div>
        {mode === "own" ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                type={showKey ? "text" : "password"}
                aria-label="Gemini API key"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your Gemini API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                className="border-input bg-background h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm"
              />
              <Button type="button" size="icon" variant="outline" className="size-10" aria-label={showKey ? "Hide key" : "Show key"} onClick={() => setShowKey(!showKey)}>
                {showKey ? <EyeOff /> : <Eye />}
              </Button>
            </div>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={remember}
                onChange={(e) => {
                  setRemember(e.target.checked);
                  if (!e.target.checked) keyStore.clear();
                }}
              />
              <span>
                Remember the key in this browser
                <span className="block text-xs text-muted-foreground">
                  Off by default. When on, it is kept in this browser&apos;s storage only and is sent to Google, nowhere else. Untick to forget it.
                </span>
              </span>
            </label>
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground" data-testid="ask-notice">
          {mode === "own" ? ASK_NOTICE_OWN : ASK_NOTICE_SERVER}
        </p>
      </fieldset>

      <div className="min-h-32 space-y-3 rounded-xl border border-ink/10 bg-background p-3" aria-live="polite">
        {turns.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {reading ? "Reading the PDFs…" : docs.length === 0 ? "None of these PDFs has selectable text. Run OCR PDF first." : "Ask anything about these PDFs."}
            </p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Button key={s} type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={busy || reading || docs.length === 0} onClick={() => setDraft(s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          turns.map((t, i) => (
            <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <p
                data-testid={`ask-${t.role}`}
                className={
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm " +
                  (t.role === "user" ? "bg-signal text-white" : "bg-secondary text-ink")
                }
              >
                {t.content}
              </p>
            </div>
          ))
        )}
        {busy ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Waiting for Gemini…
          </p>
        ) : null}
        <div ref={endRef} />
      </div>

      {error ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {fit.cut.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Too much text for one question, so only the start of {fit.cut.join(", ")} is sent.
        </p>
      ) : null}

      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSend) void send(draft);
        }}
      >
        <textarea
          aria-label="Your question"
          rows={2}
          value={draft}
          placeholder="Type a question"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) void send(draft);
            }
          }}
          className="border-input bg-background min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-sm outline-none focus-visible:ring-2"
        />
        <Button type="submit" size="lg" className="h-auto" disabled={!canSend}>
          <Send /> Ask
        </Button>
      </form>
      {turns.length > 0 ? (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={busy} onClick={() => { setTurns([]); setError(""); }}>
            <RotateCcw /> New chat
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" onClick={download}>
            <Download /> Save chat
          </Button>
        </div>
      ) : null}
    </div>
  );
}
