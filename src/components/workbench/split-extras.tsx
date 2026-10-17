"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  bookmarkCandidates,
  outlineDepth,
  partNote,
  planByBookmarks,
  planByText,
  readOutline,
  readPageTexts,
  type OutlineItem,
  type SplitPart,
} from "@/lib/split-plan";
import type { ToolOptions } from "@/lib/tool-options";

type SplitOptions = Extract<ToolOptions, { kind: "split" }>;

const OPTION_BUTTON = "h-10 sm:h-7";

/** What the file holds that the plan needs, read once per file. */
type Source =
  | { id: string; status: "loading" }
  | { id: string; status: "ready"; outline: OutlineItem[]; texts: string[] }
  | { id: string; status: "failed"; message: string };

function useSplitSource(file: File | undefined, fileKey: string, need: boolean) {
  const [source, setSource] = useState<Source | null>(null);
  useEffect(() => {
    if (!file || !need) return;
    let alive = true;
    void (async () => {
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const [outline, texts] = await Promise.all([
          readOutline(data),
          readPageTexts(data),
        ]);
        if (alive) setSource({ id: fileKey, status: "ready", outline, texts });
      } catch (error) {
        if (!alive) return;
        setSource({
          id: fileKey,
          status: "failed",
          message:
            error instanceof Error ? error.message : "Could not read this PDF.",
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [file, fileKey, need]);
  return source?.id === fileKey ? source : null;
}

function PartList({ parts }: { parts: SplitPart[] }) {
  return (
    <div className="space-y-1.5" data-testid="split-parts">
      <p className="text-sm font-medium text-ink">
        {parts.length === 1 ? "1 file" : `${parts.length} files`} will be made
      </p>
      <ol className="max-h-56 space-y-1 overflow-auto rounded-lg border border-ink/10 p-2 text-sm">
        {parts.map((part) => (
          <li
            key={part.name + part.start}
            className="flex items-baseline justify-between gap-3"
          >
            <span className="min-w-0 break-words text-ink">{part.name}.pdf</span>
            <span className="shrink-0 text-xs tabular-nums text-ink/60">
              {partNote(part).replace("Pages ", "pages ").replace("Page ", "page ")}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Toggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input
        type="checkbox"
        className="size-4"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

/** Extra controls and the live parts preview for the By bookmarks / By text modes. */
export function SplitExtras({
  options,
  onOptions,
  file,
  fileKey,
  baseName,
  disabled,
}: {
  options: SplitOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  fileKey: string;
  baseName: string;
  disabled: boolean;
}) {
  const active = options.mode === "bookmarks" || options.mode === "text";
  const source = useSplitSource(file, fileKey, active);
  const ready = source?.status === "ready" ? source : null;
  const pageCount = ready?.texts.length ?? 0;

  const maxDepth = ready ? Math.max(1, outlineDepth(ready.outline)) : 1;
  const depth = Math.min(options.bookmarkDepth, maxDepth);
  const candidates = useMemo(
    () => (ready ? bookmarkCandidates(ready.outline, depth) : []),
    [ready, depth],
  );

  const plan = useMemo(() => {
    if (!ready) return null;
    if (options.mode === "bookmarks") {
      if (ready.outline.length === 0) {
        return { ok: false as const, error: "This PDF has no bookmarks." };
      }
      return {
        ok: true as const,
        parts: planByBookmarks(
          ready.outline,
          pageCount,
          depth,
          baseName,
          options.bookmarkOff,
        ),
      };
    }
    return options.phrase.trim()
      ? planByText(ready.texts, options, baseName)
      : null;
  }, [ready, options, pageCount, depth, baseName]);

  if (!active) return null;

  if (source?.status === "failed") {
    return <p className="text-sm text-destructive">{source.message}</p>;
  }
  if (!ready) {
    return <p className="text-sm text-ink/60">Reading the PDF…</p>;
  }

  const list =
    plan && plan.ok ? (
      <PartList parts={plan.parts} />
    ) : plan ? (
      <p className="text-sm text-destructive" role="alert">
        {plan.error}
      </p>
    ) : null;

  if (options.mode === "bookmarks") {
    return (
      <div className="space-y-3">
        {maxDepth > 1 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Bookmark level</p>
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: maxDepth }, (_, i) => i + 1).map((level) => (
                <Button
                  key={level}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={depth === level ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() =>
                    onOptions({ ...options, bookmarkDepth: level, bookmarkOff: [] })
                  }
                >
                  {level === 1 ? "Top level" : `Down to level ${level}`}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {candidates.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-ink">
                Bookmarks — {candidates.length - options.bookmarkOff.length} of{" "}
                {candidates.length} used
              </p>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={OPTION_BUTTON}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, bookmarkOff: [] })}
                >
                  All
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={OPTION_BUTTON}
                  disabled={disabled}
                  onClick={() =>
                    onOptions({
                      ...options,
                      bookmarkOff: candidates.map((_, i) => i),
                    })
                  }
                >
                  None
                </Button>
              </div>
            </div>
            <ul className="max-h-44 space-y-1 overflow-auto rounded-lg border border-ink/10 p-2 text-sm">
              {candidates.map((item, index) => (
                <li key={`${item.page}-${index}`}>
                  <label className="flex items-baseline gap-2 text-ink">
                    <input
                      type="checkbox"
                      className="size-4 translate-y-0.5"
                      checked={!options.bookmarkOff.includes(index)}
                      disabled={disabled}
                      onChange={(event) =>
                        onOptions({
                          ...options,
                          bookmarkOff: event.target.checked
                            ? options.bookmarkOff.filter((n) => n !== index)
                            : [...options.bookmarkOff, index],
                        })
                      }
                    />
                    <span className="min-w-0 flex-1 break-words">{item.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink/60">
                      page {item.page + 1}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {list}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-sm font-medium text-ink" htmlFor="split-phrase">
          Start a new file at every page containing
        </label>
        <Input
          id="split-phrase"
          value={options.phrase}
          disabled={disabled}
          onChange={(e) => onOptions({ ...options, phrase: e.target.value })}
          placeholder={options.regex ? "e.g. Invoice\\s+No\\.?\\s*\\d+" : "e.g. Invoice Number"}
          autoComplete="off"
          aria-invalid={plan !== null && !plan.ok}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        <Toggle
          label="Regular expression"
          checked={options.regex}
          disabled={disabled}
          onChange={(regex) => onOptions({ ...options, regex })}
        />
        <Toggle
          label="Match case"
          checked={options.matchCase}
          disabled={disabled}
          onChange={(matchCase) => onOptions({ ...options, matchCase })}
        />
        <Toggle
          label="Whole word only"
          checked={options.wholeWord}
          disabled={disabled}
          onChange={(wholeWord) => onOptions({ ...options, wholeWord })}
        />
      </div>
      {list}
      {!ready.texts.some((text) => text.trim()) ? (
        <p className="text-sm text-ink/60">
          This PDF has no selectable text. Run OCR PDF first if it is a scan.
        </p>
      ) : null}
    </div>
  );
}
