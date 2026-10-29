"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import { planSplitGroups } from "@/lib/split-groups";
import {
  normalisePageText,
  parsePageRange,
  SPLIT_TABS,
  splitTabOf,
  type SplitMode,
  type SplitTab,
  type ToolOptions,
} from "@/lib/tool-options";

import { SplitExtras } from "./split-extras";

type SplitOptions = Extract<ToolOptions, { kind: "split" }>;

const OPTION_BUTTON = "h-10 sm:h-7";

/** The mode a tab opens on when you click it. */
const TAB_DEFAULT: Record<SplitTab, SplitMode> = {
  range: "ranges",
  pages: "pages",
  size: "size",
  smart: "smart",
};

/** A custom range row as typed; either end may be blank while editing. */
type Row = { from: string; to: string };

/** `1-3, 7, 9-` → rows. Parts that are not one span are skipped. */
export function rowsFromRanges(ranges: string, pageCount: number): Row[] {
  return normalisePageText(ranges)
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(\d*)-?(\d*)$/.exec(part);
      if (!m) return null;
      const dashed = part.includes("-");
      const from = m[1] || (dashed ? "1" : "");
      const to = m[2] || (dashed ? String(pageCount || "") : m[1]);
      return { from, to };
    })
    .filter(
      (row): row is Row => row !== null && (row.from !== "" || row.to !== ""),
    );
}

/** Rows → `1-3, 7`. Rows with a blank end are kept with the end they have. */
export function rangesFromRows(rows: Row[]): string {
  return rows
    .map(({ from, to }) => {
      const a = from.trim();
      const b = to.trim();
      if (!a && !b) return "";
      if (!a || !b || a === b) return a || b;
      return `${a}-${b}`;
    })
    .filter(Boolean)
    .join(", ");
}

function Check({
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
    <label className="flex items-start gap-2 text-sm text-ink">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="rounded-lg border border-signal/20 bg-signal/[0.06] px-3 py-2 text-xs text-ink"
      aria-live="polite"
    >
      {children}
    </p>
  );
}

function files(n: number) {
  return n === 1 ? "1 PDF" : `${n} PDFs`;
}

/** Custom ranges as from/to rows with Add range, the way iLovePDF lays them out. */
function RangeRows({
  options,
  onOptions,
  pageCount,
  disabled,
}: {
  options: SplitOptions;
  onOptions: (next: ToolOptions) => void;
  pageCount: number;
  disabled: boolean;
}) {
  // Rows keep blank ends while someone is typing; the ranges text stays the
  // source of truth, so a change made in the text box resets the rows.
  const [draft, setDraft] = useState<{ ranges: string; rows: Row[] }>(() => ({
    ranges: options.ranges,
    rows: rowsFromRanges(options.ranges, pageCount),
  }));
  let rows = draft.rows;
  if (draft.ranges !== options.ranges) {
    rows = rowsFromRanges(options.ranges, pageCount);
    setDraft({ ranges: options.ranges, rows });
  }

  const write = (next: Row[]) => {
    const ranges = rangesFromRows(next);
    setDraft({ ranges, rows: next });
    onOptions({ ...options, ranges });
  };
  const clamp = (value: string) => {
    if (value === "") return "";
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return "";
    return String(Math.max(1, pageCount > 0 ? Math.min(pageCount, n) : n));
  };
  const addRow = () => {
    const last = rows.at(-1);
    const start = last
      ? Math.min(pageCount || 1, Number(last.to || last.from || 0) + 1)
      : 1;
    write([...rows, { from: String(start), to: String(pageCount || start) }]);
  };

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No ranges yet.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((row, i) => {
            const bad =
              pageCount > 0 &&
              row.from !== "" &&
              parsePageRange(rangesFromRows([row]), pageCount).length === 0;
            return (
              <li
                key={i}
                className={`rounded-lg border bg-card p-2 ${bad ? "border-destructive/50" : "border-ink/10"}`}
              >
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-xs font-medium text-ink">
                    Range {i + 1}
                  </span>
                  {rows.length > 1 ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="size-8 sm:size-6"
                      disabled={disabled}
                      aria-label={`Remove range ${i + 1}`}
                      onClick={() => write(rows.filter((_, k) => k !== i))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(["from", "to"] as const).map((end) => (
                    <label key={end} className="space-y-1">
                      <span className="text-[11px] text-muted-foreground">
                        {end === "from" ? "From page" : "To page"}
                      </span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={pageCount || undefined}
                        value={row[end]}
                        disabled={disabled}
                        aria-label={`Range ${i + 1} ${end === "from" ? "from page" : "to page"}`}
                        onChange={(e) =>
                          write(
                            rows.map((r, k) =>
                              k === i ? { ...r, [end]: e.target.value } : r,
                            ),
                          )
                        }
                        onBlur={(e) =>
                          write(
                            rows.map((r, k) =>
                              k === i
                                ? { ...r, [end]: clamp(e.target.value) }
                                : r,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                </div>
                {bad ? (
                  <p className="mt-1 text-xs text-destructive">
                    This PDF has {pageCount} pages.
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={`${OPTION_BUTTON} w-full`}
        disabled={disabled}
        onClick={addRow}
      >
        <Plus /> Add range
      </Button>
      <label className="block space-y-1 pt-1">
        <span className="text-xs text-muted-foreground">Or type them</span>
        <Input
          id="split-ranges"
          value={options.ranges}
          disabled={disabled}
          onChange={(e) => onOptions({ ...options, ranges: e.target.value })}
          placeholder="e.g. 1-3, 4-6, 7-"
          inputMode="text"
          autoComplete="off"
        />
      </label>
    </div>
  );
}

/** Split PDF settings: Range, Pages, Size and Smart tabs. */
export function SplitOptionsPanel({
  options,
  onOptions,
  file,
  fileKey,
  baseName,
  pageCount,
  disabled,
}: {
  options: SplitOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  fileKey: string;
  baseName: string;
  /** 0 while unknown, as in the workflow builder. */
  pageCount: number;
  disabled: boolean;
}) {
  const tab = splitTabOf(options.mode);
  const modes = SPLIT_TABS.find((t) => t.id === tab)?.modes ?? [];
  const plan =
    pageCount > 0 &&
    (options.mode === "ranges" ||
      options.mode === "fixed" ||
      options.mode === "select" ||
      options.mode === "pages" ||
      options.mode === "half")
      ? planSplitGroups(options, pageCount, baseName)
      : null;
  const made = plan?.ok ? plan.groups.length : 0;
  // Custom ranges open on one range of the whole file, as iLovePDF does.
  const pick = (mode: SplitMode) =>
    onOptions({
      ...options,
      mode,
      ranges:
        mode === "ranges" && !options.ranges.trim() && pageCount > 0
          ? `1-${pageCount}`
          : options.ranges,
    });

  return (
    <div className="space-y-4">
      <SegmentedTabs
        label="How to split"
        stretch
        items={SPLIT_TABS.map((t) => ({ key: t.id, label: t.title }))}
        value={tab}
        onChange={(next) => {
          if (disabled || next === tab) return;
          pick(TAB_DEFAULT[next]);
        }}
      />

      {modes.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">
            {tab === "range"
              ? "Range mode"
              : tab === "pages"
                ? "Extract mode"
                : "Find"}
          </p>
          <div className="flex flex-wrap gap-2">
            {modes.map((mode) => (
              <Button
                key={mode.id}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.mode === mode.id ? "default" : "outline"}
                aria-pressed={options.mode === mode.id}
                disabled={disabled}
                onClick={() => pick(mode.id)}
              >
                {mode.title}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {options.mode === "ranges" ? (
        <>
          <RangeRows
            key={fileKey}
            options={options}
            onOptions={onOptions}
            pageCount={pageCount}
            disabled={disabled}
          />
          <Check
            label="Merge all ranges in one PDF file"
            checked={options.merge ?? false}
            disabled={disabled}
            onChange={(merge) => onOptions({ ...options, merge })}
          />
        </>
      ) : null}

      {options.mode === "fixed" ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-ink">
            Split into page ranges of
          </span>
          <Input
            id="split-every"
            type="number"
            inputMode="numeric"
            min={1}
            max={pageCount || undefined}
            value={options.everyN ?? 2}
            disabled={disabled}
            onChange={(e) => {
              const next = Math.floor(Number(e.target.value));
              if (!Number.isFinite(next)) return;
              onOptions({ ...options, everyN: Math.max(1, next) });
            }}
          />
        </label>
      ) : null}

      {options.mode === "select" ? (
        <>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-ink">
              Pages to extract
            </span>
            <Input
              id="split-pick"
              value={options.pick ?? ""}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, pick: e.target.value })}
              placeholder="e.g. 1, 5-8"
              inputMode="text"
              autoComplete="off"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Or click pages on the left. Shift-click picks a run.
          </p>
          <Check
            label="Merge extracted pages into one PDF file"
            checked={options.merge ?? false}
            disabled={disabled}
            onChange={(merge) => onOptions({ ...options, merge })}
          />
        </>
      ) : null}

      {options.mode === "size" ? (
        <label className="block space-y-2">
          <span className="text-sm font-medium text-ink">
            Maximum size per file (MB)
          </span>
          <Input
            id="split-size"
            type="number"
            min={0.1}
            step={0.5}
            value={options.maxMb}
            disabled={disabled}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              onOptions({ ...options, maxMb: next });
            }}
          />
        </label>
      ) : null}

      {plan ? (
        plan.ok ? (
          <Count>
            {options.mode === "pages"
              ? `Every page becomes its own PDF. ${files(made)} will be created.`
              : options.mode === "fixed"
                ? `This PDF will be split into files of ${options.everyN ?? 2} page${(options.everyN ?? 2) === 1 ? "" : "s"}. ${files(made)} will be created.`
                : options.mode === "half"
                  ? `Pages 1-${plan.groups[0].pages.length} and ${plan.groups[0].pages.length + 1}-${pageCount}. 2 PDFs will be created.`
                  : plan.merged
                    ? `${plan.groups[0].pages.length} page${plan.groups[0].pages.length === 1 ? "" : "s"} go into 1 PDF.`
                    : `${files(made)} will be created.`}
          </Count>
        ) : (
          <p className="text-sm text-destructive" role="alert">
            {plan.error}
          </p>
        )
      ) : null}

      {options.mode === "size" ? (
        <p className="text-xs text-muted-foreground">
          Pages stay whole, so a single page bigger than the limit gets a file
          of its own.
        </p>
      ) : null}

      <SplitExtras
        options={options}
        onOptions={onOptions}
        file={file}
        fileKey={fileKey}
        baseName={baseName}
        disabled={disabled}
      />
    </div>
  );
}
