"use client";

import { Button } from "@/components/ui/button";
import {
  SCAN_FILTERS,
  SCAN_LANGUAGES,
  SCAN_PAGE_SIZES,
} from "@/lib/scan/types";
import type { ToolOptions } from "@/lib/tool-options";

type ScanOptions = Extract<ToolOptions, { kind: "scan" }>;

const BUTTON = "h-10 sm:h-7";

function Slider({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <label htmlFor={id} className="font-medium text-ink">
          {label}
        </label>
        <button
          type="button"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          disabled={disabled || value === 0}
          onClick={() => onChange(0)}
        >
          {value > 0 ? `+${value}` : value} · reset
        </button>
      </div>
      <input
        id={id}
        type="range"
        min={-100}
        max={100}
        step={5}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8 w-full accent-[var(--color-signal,#2563eb)]"
      />
    </div>
  );
}

export function ScanSettings({
  options,
  onOptions,
  disabled,
}: {
  options: ScanOptions;
  onOptions: (next: ScanOptions) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<ScanOptions>) => onOptions({ ...options, ...patch });
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Filter</p>
        <div className="flex flex-wrap gap-2">
          {SCAN_FILTERS.map((f) => (
            <Button
              key={f.id}
              type="button"
              size="sm"
              className={BUTTON}
              variant={options.filter === f.id ? "default" : "outline"}
              disabled={disabled}
              onClick={() => set({ filter: f.id })}
            >
              {f.title}
            </Button>
          ))}
        </div>
        {options.filter === "bw" ? (
          <p className="text-xs text-muted-foreground">
            Pure black and white, saved as JBIG2: a text page is often under 40 KB.
          </p>
        ) : null}
      </div>
      <Slider
        id="scan-brightness"
        label="Brightness"
        value={options.brightness}
        disabled={disabled}
        onChange={(brightness) => set({ brightness })}
      />
      <Slider
        id="scan-contrast"
        label="Contrast"
        value={options.contrast}
        disabled={disabled}
        onChange={(contrast) => set({ contrast })}
      />
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Page size</p>
        <div className="flex flex-wrap gap-2">
          {SCAN_PAGE_SIZES.map((s) => (
            <Button
              key={s.id}
              type="button"
              size="sm"
              className={BUTTON}
              variant={options.pageSize === s.id ? "default" : "outline"}
              disabled={disabled}
              onClick={() => set({ pageSize: s.id })}
            >
              {s.title}
            </Button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-1 size-4"
            checked={options.searchable}
            disabled={disabled}
            onChange={(e) => set({ searchable: e.target.checked })}
          />
          <span>
            Searchable PDF
            <span className="block text-xs text-muted-foreground">
              Reads the words in this tab and hides them under the page so you can
              search and copy. Slower.
            </span>
          </span>
        </label>
        {options.searchable ? (
          <div className="space-y-1">
            <label htmlFor="scan-language" className="text-sm font-medium text-ink">
              Language on the page
            </label>
            <select
              id="scan-language"
              value={options.language}
              disabled={disabled}
              onChange={(e) => set({ language: e.target.value })}
              className="border-input bg-background h-10 w-full rounded-xl border px-3 text-sm"
            >
              {SCAN_LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}
