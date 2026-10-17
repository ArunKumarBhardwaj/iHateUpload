"use client";

import { useEffect, useRef, useState } from "react";
import { ScanSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PII_CATEGORIES, type PiiCategory } from "@/lib/pii-detect";
import { scanPdfForPii } from "@/lib/pii-scan";
import type { RedactFinding, ToolOptions } from "@/lib/tool-options";

type RedactOptions = Extract<ToolOptions, { kind: "redact" }>;

export function PiiReview({
  file,
  options,
  onOptions,
  onJump,
  disabled,
}: {
  file: File;
  options: RedactOptions;
  onOptions: (next: RedactOptions) => void;
  onJump: (pageIndex: number) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [scanned, setScanned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef({ cancelled: false });
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  // A new file means the old findings point at pages that are gone.
  const seen = useRef(file);
  useEffect(() => {
    if (seen.current === file) return;
    seen.current = file;
    run.current.cancelled = true;
    setBusy(false);
    setScanned(false);
    setProgress("");
    onOptions({ ...optionsRef.current, findings: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const scan = async () => {
    const token = { cancelled: false };
    run.current = token;
    setBusy(true);
    setError(null);
    setProgress("Reading page 1…");
    try {
      const found = await scanPdfForPii(file, {
        custom: options.custom,
        signal: token,
        onProgress: (done, total, ocr) =>
          setProgress(
            done >= total
              ? "Done"
              : `Read ${done} of ${total}${ocr ? " (OCR on a scan)" : ""}…`,
          ),
      });
      if (token.cancelled) return;
      onOptions({ ...optionsRef.current, findings: found });
      setScanned(true);
    } catch (e) {
      if (!token.cancelled) {
        setError(e instanceof Error ? e.message : "Could not scan this PDF.");
      }
    } finally {
      if (!token.cancelled) setBusy(false);
    }
  };

  const setFindings = (next: RedactFinding[]) =>
    onOptions({ ...options, findings: next });

  const groups = PII_CATEGORIES.map((c) => ({
    ...c,
    items: options.findings.filter((f) => f.category === c.id),
  })).filter((g) => g.items.length > 0);

  const toggleCategory = (id: PiiCategory, accepted: boolean) =>
    setFindings(
      options.findings.map((f) => (f.category === id ? { ...f, accepted } : f)),
    );

  const toggleOne = (id: string) =>
    setFindings(
      options.findings.map((f) =>
        f.id === id ? { ...f, accepted: !f.accepted } : f,
      ),
    );

  const accepted = options.findings.filter((f) => f.accepted).length;

  return (
    <section
      className="space-y-3 rounded-xl border border-ink/10 bg-card p-3"
      aria-label="Find personal info"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-ink">Find personal info</p>
          <p className="text-xs text-muted-foreground">
            Emails, phones, cards, Aadhaar, PAN, IFSC, accounts, IBAN, SSN and
            birth dates. Scans are read with OCR in this tab.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={disabled || busy}
          onClick={() => void scan()}
        >
          <ScanSearch />
          {busy ? "Scanning…" : scanned ? "Scan again" : "Scan document"}
        </Button>
      </div>
      <label className="block space-y-1 text-xs font-medium text-ink">
        Also look for (one word or /regex/ per line)
        <textarea
          className="block h-16 w-full rounded-lg border border-ink/15 bg-background px-2 py-1.5 font-mono text-sm"
          value={options.custom}
          disabled={disabled || busy}
          placeholder={"Project Falcon\n/ACME-\\d+/"}
          onChange={(e) => onOptions({ ...options, custom: e.target.value })}
        />
      </label>
      {busy ? (
        <p role="status" className="text-sm text-muted-foreground">
          {progress}
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {scanned && !busy && options.findings.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Nothing sensitive found. You can still draw boxes by hand.
        </p>
      ) : null}
      {groups.length > 0 ? (
        <div className="space-y-2">
          <p role="status" className="text-sm font-medium text-ink">
            {accepted} of {options.findings.length} will be burned out
          </p>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {groups.map((group) => {
              const on = group.items.filter((f) => f.accepted).length;
              return (
                <div key={group.id} className="rounded-lg bg-muted/40 p-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-ink">
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={`All ${group.label}`}
                      checked={on === group.items.length}
                      ref={(el) => {
                        if (el) el.indeterminate = on > 0 && on < group.items.length;
                      }}
                      disabled={disabled}
                      onChange={(e) => toggleCategory(group.id, e.target.checked)}
                    />
                    {group.label}
                    <span className="font-normal text-muted-foreground">
                      {on}/{group.items.length}
                    </span>
                  </label>
                  <ul className="mt-1 space-y-0.5 pl-6">
                    {group.items.map((f) => (
                      <li key={f.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="size-4"
                          aria-label={`Redact ${f.text}`}
                          checked={f.accepted}
                          disabled={disabled}
                          onChange={() => toggleOne(f.id)}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left font-mono text-xs text-ink hover:underline"
                          onClick={() => onJump(f.pageIndex)}
                        >
                          {f.text}
                        </button>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          p.{f.pageIndex + 1}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
