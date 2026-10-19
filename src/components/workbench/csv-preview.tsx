"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocConvertOptions } from "@/lib/doc-render/options";
import { applyCsvView, parseCsv } from "@/lib/doc-render/tables";
import { cn } from "@/lib/utils";

const SHOWN = 100;

/**
 * The CSV as a table you can sort, search and trim before it is printed. Whatever the table shows
 * is what the PDF prints (all matching rows, not just the first screenful).
 */
export function CsvPreview({
  file,
  options,
  onOptions,
  disabled,
}: {
  file: File;
  options: DocConvertOptions;
  onOptions: (patch: Partial<DocConvertOptions>) => void;
  disabled: boolean;
}) {
  const [loaded, setLoaded] = useState<{ file: File; rows: string[][] | null } | null>(null);
  useEffect(() => {
    let live = true;
    void file
      .text()
      .then((t) => live && setLoaded({ file, rows: parseCsv(t) }))
      .catch(() => live && setLoaded({ file, rows: null }));
    return () => {
      live = false;
    };
  }, [file]);
  const current = loaded?.file === file ? loaded : null;
  const rows = current?.rows ?? null;

  const view = useMemo(
    () => (rows ? applyCsvView(rows, { sort: options.csvSort, filter: options.csvFilter, hidden: options.csvHidden }) : []),
    [rows, options.csvSort, options.csvFilter, options.csvHidden],
  );

  if (current && !rows) return null;
  if (!rows) return <p className="text-sm text-muted-foreground">Reading the table…</p>;
  if (!rows.length) return null;

  const head = rows[0];
  const cols = Math.max(...rows.map((r) => r.length));
  const total = rows.length - 1;
  const matching = view.length - 1;
  const sort = options.csvSort;
  const hidden = new Set(options.csvHidden);

  const cycle = (col: number) => {
    if (sort?.col !== col) onOptions({ csvSort: { col, dir: "asc" } });
    else if (sort.dir === "asc") onOptions({ csvSort: { col, dir: "desc" } });
    else onOptions({ csvSort: null });
  };
  const toggleCol = (col: number) => {
    const next = hidden.has(col) ? options.csvHidden.filter((c) => c !== col) : [...options.csvHidden, col];
    if (next.length >= cols) return; // at least one column stays
    onOptions({ csvHidden: next, csvSort: sort && next.includes(sort.col) ? null : sort });
  };
  const label = (c: number) => head[c]?.trim() || `Column ${c + 1}`;
  const shownCols = Array.from({ length: cols }, (_, c) => c).filter((c) => !hidden.has(c));
  const edited = !!sort || !!options.csvFilter.trim() || hidden.size > 0;

  return (
    <section className="space-y-3 rounded-2xl border border-ink/10 bg-background px-4 py-4" aria-label="Table preview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-ink">Preview</p>
        <p className="text-xs text-muted-foreground" role="status" data-testid="csv-count">
          {options.csvFilter.trim() ? `${matching} of ${total} rows match` : `${total} row${total === 1 ? "" : "s"}`}
          {" · the PDF prints exactly this"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          value={options.csvFilter}
          disabled={disabled}
          onChange={(e) => onOptions({ csvFilter: e.target.value })}
          placeholder="Search rows"
          aria-label="Search rows"
          className="h-9 max-w-64"
        />
        {edited ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9"
            disabled={disabled}
            onClick={() => onOptions({ csvSort: null, csvFilter: "", csvHidden: [] })}
          >
            Reset
          </Button>
        ) : null}
      </div>

      {cols > 1 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Columns to print">
          <span className="text-xs text-muted-foreground">Columns</span>
          {Array.from({ length: cols }, (_, c) => (
            <Button
              key={c}
              type="button"
              size="sm"
              className="h-7 max-w-40 truncate px-2 text-xs"
              variant={hidden.has(c) ? "outline" : "default"}
              aria-pressed={!hidden.has(c)}
              disabled={disabled}
              onClick={() => toggleCol(c)}
              title={hidden.has(c) ? `Show ${label(c)}` : `Hide ${label(c)}`}
            >
              {label(c)}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="max-h-80 overflow-auto rounded-lg border border-ink/10">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-secondary">
            <tr>
              {shownCols.map((c) => {
                const active = sort?.col === c;
                const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
                return (
                  <th key={c} scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="border-b border-ink/10 p-0">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => cycle(c)}
                      className={cn("flex w-full items-center gap-1 px-2 py-1.5 font-semibold text-ink hover:bg-ink/5", active && "text-signal-ink")}
                      title={`Sort by ${label(c)}`}
                    >
                      <span className="truncate">{label(c)}</span>
                      <Icon className="size-3 shrink-0 opacity-70" aria-hidden />
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {view.slice(1, SHOWN + 1).map((r, i) => (
              <tr key={i} className={i % 2 ? "bg-secondary/40" : undefined}>
                {shownCols.map((c, k) => (
                  <td key={c} className="max-w-56 truncate border-b border-ink/5 px-2 py-1 text-ink">
                    {/* view rows already dropped hidden columns */}
                    {r[k] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
            {matching === 0 ? (
              <tr>
                <td colSpan={shownCols.length} className="px-2 py-4 text-center text-muted-foreground">
                  No rows contain that text.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {matching > SHOWN ? (
        <p className="text-xs text-muted-foreground">Showing the first {SHOWN} of {matching} rows. The PDF prints all {matching}.</p>
      ) : null}
    </section>
  );
}
