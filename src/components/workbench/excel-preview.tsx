"use client";

import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ResultItem } from "@/lib/job";
import type { ColType } from "@/lib/pdf-to-excel/cells";
import { deleteColumn, deleteRow, renameTable, setCell, setColumnType, setHeaderRows, setIncluded } from "@/lib/pdf-to-excel/edit";
import { cn } from "@/lib/utils";

const TYPES: { id: ColType; title: string }[] = [
  { id: "auto", title: "Auto" },
  { id: "text", title: "Text" },
  { id: "number", title: "Number" },
  { id: "currency", title: "Currency" },
  { id: "percent", title: "Percent" },
  { id: "date", title: "Date" },
];
const PAGE = 50;

/**
 * The tables we found, as an editable grid, before the file is saved. Each edit rebuilds the
 * workbook behind the Save button, so what you see here is what you get.
 */
export function ExcelPreview({ result }: { result: ResultItem }) {
  const editor = result.editor!;
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(PAGE);
  // `shape` remounts the inputs when rows or columns move; `stats` only refreshes the badges.
  const [shape, setShape] = useState(0);
  const [, setStats] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rebuild = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const built = await editor.build();
      result.blob = new Blob([built.bytes as BlobPart], { type: result.blob.type });
      result.size = result.blob.size;
    }, 250);
  }, [editor, result]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const grids = editor.tables();
  if (!grids.length) return null;
  const grid = grids[Math.min(active, grids.length - 1)];
  const columns = editor.columns(grid);
  const headers = editor.headerRows(grid);
  const warnings = editor.warnings();
  const changed = (structure: boolean) => {
    if (structure) setShape((n) => n + 1);
    setStats((n) => n + 1);
    rebuild();
  };

  return (
    <section className="space-y-3 rounded-2xl border border-ink/10 bg-background px-4 py-4" aria-label="Preview and edit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal-ink">Preview and edit</p>
        <p className={cn("flex items-center gap-1.5 text-xs", warnings ? "text-signal-ink" : "text-muted-foreground")} role="status">
          {warnings ? <AlertTriangle className="size-3.5" /> : null}
          {warnings ? `${warnings} cell${warnings === 1 ? "" : "s"} could not be typed` : "Every value fits its column"}
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist">
        {grids.map((g, i) => (
          <Button
            key={i}
            type="button"
            size="sm"
            role="tab"
            aria-selected={i === active}
            className="h-8 max-w-48 truncate"
            variant={i === active ? "default" : "outline"}
            onClick={() => {
              setActive(i);
              setLimit(PAGE);
              setShape((n) => n + 1);
            }}
          >
            <span className={cn("truncate", g.skip && "line-through opacity-60")}>{g.name}</span>
          </Button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-40 flex-1 space-y-1 text-xs text-muted-foreground">
          Sheet name
          <Input
            key={`name-${active}`}
            defaultValue={grid.name}
            maxLength={31}
            onChange={(e) => {
              renameTable(grid, e.target.value);
              changed(false);
            }}
          />
        </label>
        <div className="space-y-1 text-xs text-muted-foreground">
          Header rows
          <div className="flex items-center gap-1">
            {[0, 1, 2, 3].map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                className="size-8"
                variant={headers === n ? "default" : "outline"}
                aria-label={`${n} header rows`}
                onClick={() => {
                  setHeaderRows(grid, n);
                  changed(true);
                }}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4"
            checked={!grid.skip}
            onChange={(e) => {
              setIncluded(grid, e.target.checked);
              changed(true);
            }}
          />
          Include this table
        </label>
      </div>

      <div className="max-h-96 overflow-auto rounded-lg border border-ink/10">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="w-8 border-b border-ink/10" />
              {columns.map((info, c) => (
                <th key={c} className="min-w-28 border-b border-l border-ink/10 px-1.5 py-1.5 text-left align-top font-normal">
                  <div className="flex items-center gap-1">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[11px] font-medium",
                        info.kind === "text" ? "bg-ink/5 text-ink/70" : "bg-signal/10 text-signal-ink",
                      )}
                      title={info.inferred ? "Guessed from the values" : "Set by you"}
                    >
                      {info.kind}
                      {info.inferred ? "" : " ·"}
                    </span>
                    {info.warnings ? (
                      <span className="flex items-center gap-0.5 text-[11px] text-signal-ink" title="Cells that do not fit this type">
                        <AlertTriangle className="size-3" />
                        {info.warnings}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="ml-auto rounded p-0.5 text-muted-foreground hover:text-ink"
                      aria-label={`Delete column ${c + 1}`}
                      onClick={() => {
                        deleteColumn(grid, c);
                        changed(true);
                      }}
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <select
                    className="mt-1 h-7 w-full rounded-md border border-input bg-transparent px-1 text-xs"
                    aria-label={`Type of column ${c + 1}`}
                    value={grid.colTypes?.[c] ?? "auto"}
                    onChange={(e) => {
                      setColumnType(grid, c, e.target.value as ColType);
                      changed(true);
                    }}
                  >
                    {TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.id === "auto" ? `Auto (${info.inferred ? info.kind : "…"})` : t.title}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.rows.slice(0, limit).map((row, r) => (
              <tr key={`${shape}-${r}`} className={r < headers ? "bg-signal/5 font-semibold" : undefined}>
                <td className="border-b border-ink/5 text-center">
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-ink"
                    aria-label={`Delete row ${r + 1}`}
                    onClick={() => {
                      deleteRow(grid, r);
                      changed(true);
                    }}
                  >
                    <X className="size-3" />
                  </button>
                </td>
                {row.map((cell, c) => (
                  <td key={c} className="border-b border-l border-ink/5 p-0">
                    {cell.covered ? null : (
                      <input
                        className="h-8 w-full bg-transparent px-2 text-sm outline-none focus:bg-signal/5"
                        defaultValue={cell.text}
                        aria-label={`Row ${r + 1}, column ${c + 1}`}
                        onBlur={(e) => {
                          if (e.target.value !== cell.text) {
                            setCell(grid, r, c, e.target.value);
                            changed(false);
                          }
                        }}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {grid.rows.length} row{grid.rows.length === 1 ? "" : "s"}, {columns.length} column{columns.length === 1 ? "" : "s"}
        </span>
        {grid.rows.length > limit ? (
          <Button type="button" size="sm" variant="outline" onClick={() => setLimit((n) => n + 200)}>
            Show {Math.min(200, grid.rows.length - limit)} more rows
          </Button>
        ) : null}
      </div>
    </section>
  );
}
