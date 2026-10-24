"use client";

import { useEffect, useMemo, useState } from "react";

import { findDocuments, maybeCuts, smartDocs, type PageInfo } from "@/lib/smart-split/detect";
import { readSmartPages } from "@/lib/smart-split/read";
import type { ToolOptions } from "@/lib/tool-options";

type SplitOptions = Extract<ToolOptions, { kind: "split" }>;

type State =
  | { file: File; status: "reading"; done: number; total: number }
  | { file: File; status: "ready"; pages: PageInfo[] }
  | { file: File; status: "failed"; message: string };

const span = (pages: number[]) =>
  pages.length === 1 ? `page ${pages[0] + 1}` : `pages ${pages[0] + 1}–${pages[pages.length - 1] + 1}`;

/** The documents Smart split found, with a switch for every cut and for each near miss. */
export function SmartSplitPanel({
  options,
  onOptions,
  file,
  disabled,
}: {
  options: SplitOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  disabled: boolean;
}) {
  const [state, setState] = useState<State | null>(null);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    readSmartPages(file, (done, total) => {
      if (alive) setState((s) => (s?.status === "ready" && s.file === file ? s : { file, status: "reading", done, total }));
    }).then(
      (pages) => alive && setState({ file, status: "ready", pages }),
      (error: unknown) =>
        alive && setState({ file, status: "failed", message: error instanceof Error ? error.message : "Could not read this PDF." }),
    );
    return () => {
      alive = false;
    };
  }, [file]);

  const current = state?.file === file ? state : null;
  const pages = current?.status === "ready" ? current.pages : null;
  const plan = useMemo(() => (pages ? findDocuments(pages) : null), [pages]);
  const docs = useMemo(
    () => (plan && pages ? smartDocs(plan, pages, { off: options.smartOff, on: options.smartOn, dropBlank: options.dropBlank }) : []),
    [plan, pages, options.smartOff, options.smartOn, options.dropBlank],
  );
  const maybe = useMemo(() => (plan ? maybeCuts(plan).slice(0, 6) : []), [plan]);

  if (!file) return null;
  if (current?.status === "failed") return <p className="text-sm text-destructive">{current.message}</p>;
  if (!plan || !pages) {
    return (
      <p className="text-sm text-ink/60" role="status">
        {current?.status === "reading"
          ? `Reading page ${current.done} of ${current.total}… Scanned pages are read with OCR in this tab.`
          : "Reading the PDF…"}
      </p>
    );
  }

  const toggle = (list: number[], page: number, on: boolean) => (on ? [...list.filter((p) => p !== page), page] : list.filter((p) => p !== page));

  return (
    <div className="space-y-3" data-testid="smart-split">
      <p className="text-sm font-medium text-ink">
        {docs.length === 1 ? "1 document found" : `${docs.length} documents found`} in {pages.length} pages
      </p>
      <ol className="max-h-72 space-y-1.5 overflow-auto rounded-lg border border-ink/10 p-2 text-sm">
        {plan.starts.map((start, index) => {
          const kept = index === 0 || !options.smartOff.includes(start.page);
          const doc = docs.find((d) => d.pages[0] === start.page || (index === 0 && d === docs[0]));
          return (
            <li key={start.page}>
              <label className="flex items-baseline gap-2 text-ink">
                <input
                  type="checkbox"
                  className="size-4 translate-y-0.5"
                  aria-label={`Cut before page ${start.page + 1}`}
                  checked={kept}
                  disabled={disabled || index === 0}
                  onChange={(e) => onOptions({ ...options, smartOff: toggle(options.smartOff, start.page, !e.target.checked) })}
                />
                <span className="min-w-0 flex-1">
                  <span className="break-words">{start.label}</span>
                  <span className="block text-xs text-ink/60">
                    {kept && doc ? span(doc.pages) : `joined to the one before, from page ${start.page + 1}`}
                    {index > 0 ? ` · ${start.reasons.slice(0, 3).join(", ")}` : ""}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ol>
      {maybe.length ? (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-ink">Maybe also cut at</p>
          <ul className="space-y-1 text-sm">
            {maybe.map((m) => (
              <li key={m.page}>
                <label className="flex items-baseline gap-2 text-ink">
                  <input
                    type="checkbox"
                    className="size-4 translate-y-0.5"
                    checked={options.smartOn.includes(m.page)}
                    disabled={disabled}
                    onChange={(e) => onOptions({ ...options, smartOn: toggle(options.smartOn, m.page, e.target.checked) })}
                  />
                  <span className="min-w-0 flex-1">
                    Page {m.page + 1}
                    <span className="text-xs text-ink/60"> · {m.reasons.slice(0, 3).join(", ") || "weak signs"}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.blanks.length ? (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4"
            checked={options.dropBlank}
            disabled={disabled}
            onChange={(e) => onOptions({ ...options, dropBlank: e.target.checked })}
          />
          Leave out {plan.blanks.length === 1 ? "the blank page" : `${plan.blanks.length} blank pages`}
        </label>
      ) : null}
    </div>
  );
}
