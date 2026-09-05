"use client";

import { Check, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ResultItem } from "@/lib/job";
import type { ToolDefinition } from "@/lib/tools";
import { downloadBlob, formatBytes } from "@/lib/utils";

/** Real measured change, not an estimate: we already did the work locally. */
function sizeDelta(results: ResultItem[]) {
  const before = results.reduce((sum, result) => sum + result.originalSize, 0);
  const after = results.reduce((sum, result) => sum + result.size, 0);
  if (before === 0 || after === before) return null;
  return { before, after, percent: Math.round((1 - after / before) * 100) };
}

export function ResultPanel({
  results,
  continueTargets,
  onContinue,
}: {
  results: ResultItem[];
  continueTargets: ToolDefinition[];
  onContinue: (tool: ToolDefinition) => void;
}) {
  const delta = sizeDelta(results);
  const answer = results.find((result) => result.previewText)?.previewText;

  return (
    <div className="space-y-4">
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border border-signal/20 bg-signal/5 px-4 py-3"
      >
        <p className="flex items-center gap-2 text-base font-semibold text-ink">
          <Check className="size-4 text-signal" />
          {answer
            ? "Text is ready"
            : results.length === 1
              ? "1 file is ready"
              : `${results.length} files are ready`}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {answer
            ? "Built on this device. Nothing was uploaded."
            : delta ? (
              <>
                {formatBytes(delta.before)} → {formatBytes(delta.after)}{" "}
                <span
                  className={
                    delta.percent > 0 ? "font-medium text-signal" : undefined
                  }
                >
                  ({delta.percent > 0 ? "−" : "+"}
                  {Math.abs(delta.percent)}%)
                </span>
              </>
            ) : (
              "Built on this device. Nothing was uploaded."
            )}
        </p>
      </div>

      {answer ? (
        <div className="rounded-2xl border border-ink/8 bg-background px-4 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">
            Text
          </p>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {answer}
          </p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {results.map((result) => (
          <li
            key={result.id}
            className="flex items-center gap-3 rounded-lg border border-ink/10 bg-card px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink" title={result.name}>
                {result.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(result.originalSize)} → {formatBytes(result.size)}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => downloadBlob(result.blob, result.name)}
            >
              <Download />
              Save
            </Button>
          </li>
        ))}
      </ul>

      {continueTargets.length > 0 && (
        <div className="space-y-2 border-t border-ink/10 pt-4">
          <p className="text-sm font-medium text-ink">Continue with</p>
          <div className="flex flex-wrap gap-2">
            {continueTargets.map((next) => (
              <Button
                key={next.id}
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onContinue(next)}
              >
                {next.shortTitle}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
