"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  NUP_PRESETS,
  nupCells,
  nupSheet,
  type NupSettings,
} from "@/lib/page-tools/nup";
import type { NupPaper } from "@/lib/page-tools/types";
import type { ToolOptions } from "@/lib/tool-options";
import { cn } from "@/lib/utils";

const BTN = "h-10 sm:h-7";

type NupOptions = Extract<ToolOptions, { kind: "nup" }>;

const PAPERS: [NupPaper, string][] = [
  ["a4", "A4"],
  ["letter", "Letter"],
  ["legal", "Legal"],
  ["a3", "A3"],
];

function Num({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
      />
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  items,
  disabled,
  onPick,
}: {
  label: string;
  value: T;
  items: [T, string][];
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div className="flex flex-wrap gap-2">
        {items.map(([id, title]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            className={BTN}
            variant={value === id ? "default" : "outline"}
            aria-pressed={value === id}
            disabled={disabled}
            onClick={() => onPick(id)}
          >
            {title}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** A to-scale sketch of the sheet with numbered cells, so the order is obvious. */
function Sketch({ options }: { options: NupSettings }) {
  const sheet = nupSheet(options, { width: 595, height: 842 });
  const cells = nupCells(options, sheet.width, sheet.height);
  const width = 150;
  const scale = width / sheet.width;
  return (
    <div
      role="img"
      aria-label={`Sheet with ${cells.length} pages, filled ${options.order === "across" ? "across then down" : "down then across"}`}
      className="relative mx-auto rounded-sm bg-white shadow-sm ring-1 ring-ink/15"
      style={{ width, height: sheet.height * scale }}
    >
      {cells.map((cell, index) => (
        <div
          key={index}
          className={cn(
            "absolute flex items-center justify-center bg-signal/10 text-[10px] font-medium text-signal",
            options.border && "outline outline-1 outline-ink/40",
          )}
          style={{
            left: cell.x * scale,
            top: (sheet.height - cell.y - cell.h) * scale,
            width: cell.w * scale,
            height: cell.h * scale,
          }}
        >
          {index + 1}
        </div>
      ))}
    </div>
  );
}

export function NupPanel({
  options,
  onOptions,
  disabled,
}: {
  options: NupOptions;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<NupSettings>) =>
    onOptions({ ...options, ...patch });
  const total = options.cols * options.rows;
  const preset = NUP_PRESETS.find(
    (p) => p.cols === options.cols && p.rows === options.rows,
  );
  return (
    <div className="space-y-4">
      <Sketch options={options} />
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Pages per sheet</p>
        <div className="flex flex-wrap gap-2">
          {NUP_PRESETS.map((p) => (
            <Button
              key={p.n}
              type="button"
              size="sm"
              className={BTN}
              variant={preset?.n === p.n ? "default" : "outline"}
              aria-pressed={preset?.n === p.n}
              disabled={disabled}
              onClick={() => set({ cols: p.cols, rows: p.rows })}
            >
              {p.n}
            </Button>
          ))}
          <Button
            type="button"
            size="sm"
            className={BTN}
            variant={preset ? "outline" : "default"}
            aria-pressed={!preset}
            disabled={disabled}
            onClick={() => set({ cols: 3, rows: 4 })}
          >
            Custom
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Num
            id="nup-rows"
            label="Rows"
            value={options.rows}
            min={1}
            max={10}
            disabled={disabled}
            onChange={(rows) => set({ rows })}
          />
          <Num
            id="nup-cols"
            label="Columns"
            value={options.cols}
            min={1}
            max={10}
            disabled={disabled}
            onChange={(cols) => set({ cols })}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {total} pages on each sheet.
        </p>
      </div>
      <Choice
        label="Paper"
        value={options.paper}
        items={PAPERS}
        disabled={disabled}
        onPick={(paper) => set({ paper })}
      />
      <Choice
        label="Orientation"
        value={options.orientation}
        items={[
          ["auto", "Auto"],
          ["portrait", "Portrait"],
          ["landscape", "Landscape"],
        ]}
        disabled={disabled}
        onPick={(orientation) => set({ orientation })}
      />
      <Choice
        label="Fill order"
        value={options.order}
        items={[
          ["across", "Across, then down"],
          ["down", "Down, then across"],
        ]}
        disabled={disabled}
        onPick={(order) => set({ order })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Num
          id="nup-margin"
          label="Margin (mm)"
          value={options.margin}
          min={0}
          max={50}
          disabled={disabled}
          onChange={(margin) => set({ margin })}
        />
        <Num
          id="nup-gap"
          label="Gap (mm)"
          value={options.gap}
          min={0}
          max={50}
          disabled={disabled}
          onChange={(gap) => set({ gap })}
        />
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--signal)]"
          checked={options.border}
          disabled={disabled}
          onChange={(e) => set({ border: e.target.checked })}
        />
        Draw a border around each page
      </label>
    </div>
  );
}
