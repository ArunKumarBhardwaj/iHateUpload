"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { findMatches, mergePlanned, planFindReplace, type PageRuns } from "@/lib/edit-find-replace";
import { loadPdfJs } from "@/lib/pdfjs";
import { fontFromName, mergeTextRuns, pdfJsItemsToRuns, type PdfJsLikeItem } from "@/lib/pdf-edit-runs";
import type { EditMark } from "@/lib/tool-options";

/** Find a phrase on every page and replace it, in the PDF itself. */
export function EditFindPanel({
  file,
  pageCount,
  marks,
  disabled,
  onApply,
  onJump,
}: {
  file: File;
  pageCount: number;
  marks: EditMark[];
  disabled: boolean;
  onApply: (marks: EditMark[]) => void;
  onJump: (pageIndex: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [pages, setPages] = useState<PageRuns[] | null>(null);
  const [seenFile, setSeenFile] = useState(file);
  const [message, setMessage] = useState("");
  const [current, setCurrent] = useState(0);

  if (seenFile !== file) {
    setSeenFile(file);
    setPages(null);
    setMessage("");
  }

  useEffect(() => {
    if (!open || pages) return;
    let cancelled = false;
    void (async () => {
      const { getDocument } = await loadPdfJs();
      const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      try {
        const out: PageRuns[] = [];
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          const runs = mergeTextRuns(
            pdfJsItemsToRuns(
              content.items as PdfJsLikeItem[],
              viewport.width,
              viewport.height,
              (x, y) => {
                const [vx, vy] = viewport.convertToViewportPoint(x, y);
                return { x: vx, y: vy };
              },
              (fontName) => {
                if (!fontName) return undefined;
                let real: string | undefined;
                try {
                  real = (page.commonObjs.get(fontName) as { name?: string } | undefined)?.name;
                } catch {
                  real = undefined;
                }
                return fontFromName(real, content.styles[fontName]?.fontFamily);
              },
            ),
          );
          out.push({ pageIndex: n - 1, runs });
          page.cleanup();
        }
        if (!cancelled) setPages(out);
      } finally {
        await doc.loadingTask.destroy();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, pages, file]);

  const options = { matchCase, wholeWord };
  const matches = pages ? findMatches(pages, marks, find, options) : [];
  const at = matches.length ? Math.min(current, matches.length - 1) : 0;
  const pagesHit = [...new Set(matches.map((m) => m.pageIndex))];

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (at + delta + matches.length) % matches.length;
    setCurrent(next);
    setMessage("");
    onJump(matches[next].pageIndex);
  };

  const apply = (only?: (typeof matches)[number]) => {
    if (!pages) return;
    const plan = planFindReplace(pages, marks, find, replace, options, only);
    if (plan.marks.length === 0) return;
    onApply(mergePlanned(marks, plan.marks));
    setMessage(
      `Replaced ${plan.matches} ${plan.matches === 1 ? "match" : "matches"} on ${plan.pagesHit.length} ${plan.pagesHit.length === 1 ? "page" : "pages"}.`,
    );
  };

  if (!open) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-10 gap-1.5 sm:h-8"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <Search /> Find and replace
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-xl border border-ink/10 bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          aria-label="Find"
          placeholder="Find"
          value={find}
          disabled={disabled}
          className="h-10 w-44 sm:h-8"
          onChange={(e) => {
            setFind(e.target.value);
            setCurrent(0);
            setMessage("");
          }}
        />
        <Input
          aria-label="Replace with"
          placeholder="Replace with"
          value={replace}
          disabled={disabled}
          className="h-10 w-44 sm:h-8"
          onChange={(e) => setReplace(e.target.value)}
        />
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input type="checkbox" checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} />
          Match case
        </label>
        <label className="flex items-center gap-1.5 text-sm text-ink">
          <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
          Whole word
        </label>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Previous match"
          className="size-10 sm:size-8"
          disabled={disabled || matches.length === 0}
          onClick={() => step(-1)}
        >
          <ChevronUp />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label="Next match"
          className="size-10 sm:size-8"
          disabled={disabled || matches.length === 0}
          onClick={() => step(1)}
        >
          <ChevronDown />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || matches.length === 0}
          onClick={() => apply(matches[at])}
        >
          Replace
        </Button>
        <Button type="button" size="sm" disabled={disabled || matches.length === 0} onClick={() => apply()}>
          Replace all
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite" data-testid="find-status">
        {message ||
          (!pages
            ? `Reading ${pageCount || ""} pages…`
            : !find
              ? "Whole lines are rewritten in a matching standard font. Pages that are scans have no text to find."
              : matches.length > 0
                ? `Match ${at + 1} of ${matches.length}, on ${pagesHit.length} ${pagesHit.length === 1 ? "page" : "pages"}.`
                : "No matches.")}
        {pagesHit.length > 0 && !message ? (
          <span className="ml-2 inline-flex flex-wrap gap-1">
            {pagesHit.slice(0, 12).map((index) => (
              <button
                key={index}
                type="button"
                className="rounded border border-ink/15 px-1.5 text-xs text-ink hover:border-signal"
                onClick={() => onJump(index)}
              >
                p{index + 1}
              </button>
            ))}
          </span>
        ) : null}
      </p>
    </div>
  );
}
