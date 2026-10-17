"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { planFindReplace, type PageRuns } from "@/lib/edit-find-replace";
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

  const plan = pages
    ? planFindReplace(pages, find, replace, { matchCase, wholeWord })
    : null;

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
          size="sm"
          disabled={disabled || !plan || plan.marks.length === 0}
          onClick={() => {
            if (!plan) return;
            // A line already being edited is replaced by the new plan for that line.
            const kept = marks.filter(
              (m) =>
                !(
                  m.kind === "text" &&
                  m.cover &&
                  plan.marks.some(
                    (p) =>
                      p.pageIndex === m.pageIndex &&
                      Math.abs(p.x - m.x) < 0.01 &&
                      Math.abs(p.y - m.y) < 0.01,
                  )
                ),
            );
            onApply([...kept, ...plan.marks]);
            setMessage(
              `Replaced ${plan.matches} ${plan.matches === 1 ? "match" : "matches"} on ${plan.pagesHit.length} ${plan.pagesHit.length === 1 ? "page" : "pages"}.`,
            );
          }}
        >
          Replace all
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Close
        </Button>
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {message ||
          (!pages
            ? `Reading ${pageCount || ""} pages…`
            : !find
              ? "Whole lines are rewritten in a matching standard font. Pages that are scans have no text to find."
              : plan && plan.matches > 0
                ? `${plan.matches} ${plan.matches === 1 ? "match" : "matches"} on ${plan.pagesHit.length} ${plan.pagesHit.length === 1 ? "page" : "pages"}.`
                : "No matches.")}
        {plan && plan.pagesHit.length > 0 && !message ? (
          <span className="ml-2 inline-flex flex-wrap gap-1">
            {plan.pagesHit.slice(0, 12).map((index) => (
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
