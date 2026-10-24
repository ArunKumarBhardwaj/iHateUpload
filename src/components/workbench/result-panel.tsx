"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Copy, Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ExcelPreview } from "@/components/workbench/excel-preview";
import type { ResultItem } from "@/lib/job";
import type { ToolDefinition } from "@/lib/tools";
import { downloadBlob, formatBytes } from "@/lib/utils";

/**
 * Real measured saving, not an estimate: we already did the work locally.
 * Only for tools whose job is shrinking. Split parts share one input, and
 * growth is expected from tools like PDF to JPG or Sign, so a percentage
 * there would mislead.
 */
function sizeDelta(results: ResultItem[]) {
  const before = results.reduce((sum, result) => sum + result.originalSize, 0);
  const after = results.reduce((sum, result) => sum + result.size, 0);
  if (before === 0 || after >= before) return null;
  return { before, after, percent: Math.round((1 - after / before) * 100) };
}

function CopyText({ text, label = "Copy text" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function ResultPanel({
  results,
  showSaving,
  continueTargets,
  onContinue,
  workflowHref,
  builtNote = "Built on this device. Nothing was uploaded.",
}: {
  results: ResultItem[];
  showSaving: boolean;
  continueTargets: ToolDefinition[];
  onContinue: (tool: ToolDefinition) => void;
  /** Where "save these steps as a workflow" goes; absent for tools a workflow cannot run. */
  workflowHref?: string;
  /** The privacy line under the title, for tools that send text elsewhere. */
  builtNote?: string;
}) {
  const delta = showSaving ? sizeDelta(results) : null;
  const texts = results.filter((result) => result.previewText);
  const answer = texts[0]?.previewText;

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
            ? builtNote
            : delta ? (
              <>
                {formatBytes(delta.before)} → {formatBytes(delta.after)}{" "}
                <span className="font-medium text-signal-ink">
                  (−{delta.percent}%)
                </span>
              </>
            ) : (
              builtNote
            )}
        </p>
      </div>

      {texts.map((result) => (
        <div key={result.id} className="rounded-2xl border border-ink/8 bg-background px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-[0.14em] text-signal-ink">
              {texts.length > 1 ? result.name : "Text"}
            </p>
            <CopyText text={result.previewText ?? ""} />
          </div>
          <p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-sm leading-relaxed text-ink">
            {result.previewText}
          </p>
        </div>
      ))}

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
                {delta
                  ? `${formatBytes(result.originalSize)} → ${formatBytes(result.size)}`
                  : formatBytes(result.size)}
              </p>
              {result.note ? (
                <p className="mt-1 text-xs text-ink/70">{result.note}</p>
              ) : null}
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

      {results
        .filter((result) => result.htmlPreview)
        .map((result) => (
          <div key={result.id} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-ink">
                Preview
              </p>
              <CopyText text={result.htmlPreview ?? ""} label="Copy HTML" />
            </div>
            <iframe
              title={`Preview of ${result.name}`}
              sandbox="allow-scripts"
              srcDoc={result.htmlPreview}
              className="h-[28rem] w-full rounded-xl border border-ink/10 bg-white"
            />
          </div>
        ))}

      {results.filter((result) => result.editor).map((result) => (
        <ExcelPreview key={result.id} result={result} />
      ))}

      {workflowHref ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-ink/10 pt-4 text-sm">
          <Link
            href={workflowHref}
            className="font-medium text-signal-ink underline-offset-4 hover:underline"
          >
            Save these steps as a workflow
          </Link>
          <span className="text-muted-foreground">
            Run them on many files at once. Passwords are not kept.
          </span>
        </div>
      ) : null}

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
