"use client";

import { useState } from "react";

import { PageGrid } from "@/components/page-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PAPER,
  PAPER_TITLES,
  fromPoints,
  toPoints,
} from "@/lib/page-tools/geometry";
import type { ResizeSettings } from "@/lib/page-tools/resize";
import type { PaperId, SizeUnit } from "@/lib/page-tools/types";
import type { ToolOptions } from "@/lib/tool-options";
import { usePdfSession } from "@/lib/use-pdf-session";

const BTN = "h-10 sm:h-7";

type SizeOptions = Extract<ToolOptions, { kind: "page-size" }>;

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

export function PageSizePanel({
  options,
  onOptions,
  file,
  disabled,
}: {
  options: SizeOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  disabled: boolean;
}) {
  const { session, pages: sizes } = usePdfSession(file);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const set = (patch: Partial<ResizeSettings>) =>
    onOptions({ ...options, ...patch });

  const choosePaper = (size: PaperId) => {
    if (size === "custom") {
      // Start the custom box from the sheet that was showing.
      const [w, h] =
        options.size === "custom"
          ? [options.width, options.height]
          : PAPER[options.size].map((pt) => fromPoints(pt, options.unit));
      set({ size, width: Number(w.toFixed(1)), height: Number(h.toFixed(1)) });
    } else set({ size });
  };

  const gridPages = (sizes ?? []).map((_, i) => ({
    key: String(i),
    page: i,
    turn: 0,
  }));

  const num = (id: string, label: string, value: number, key: "width" | "height") => (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        min={1}
        step={options.unit === "pt" ? 1 : 0.5}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n > 0) {
            // Keep the aspect of the box when the other side is left alone only on request.
            set({ [key]: n } as Partial<ResizeSettings>);
          }
        }}
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <Choice
        label="Sheet"
        value={options.size}
        items={(Object.keys(PAPER_TITLES) as PaperId[]).map((id) => [id, PAPER_TITLES[id]])}
        disabled={disabled}
        onPick={choosePaper}
      />
      {options.size === "custom" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {num("size-w", "Width", options.width, "width")}
            {num("size-h", "Height", options.height, "height")}
          </div>
          <Choice
            label="Unit"
            value={options.unit}
            items={[
              ["mm", "mm"],
              ["in", "inches"],
              ["pt", "points"],
            ]}
            disabled={disabled}
            onPick={(unit: SizeUnit) => {
              const conv = (v: number) =>
                Number(fromPoints(toPoints(v, options.unit), unit).toFixed(2));
              set({ unit, width: conv(options.width), height: conv(options.height) });
            }}
          />
        </div>
      ) : null}
      <Choice
        label="Orientation"
        value={options.orientation}
        items={[
          ["auto", "Keep each page's"],
          ["portrait", "Portrait"],
          ["landscape", "Landscape"],
        ]}
        disabled={disabled}
        onPick={(orientation) => set({ orientation })}
      />
      <Choice
        label="How to fit"
        value={options.fit}
        items={[
          ["letterbox", "Keep whole page"],
          ["fit", "Fill sheet"],
          ["stretch", "Stretch"],
        ]}
        disabled={disabled || !options.scale}
        onPick={(fit) => set({ fit })}
      />
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--signal)]"
          checked={options.scale}
          disabled={disabled}
          onChange={(e) => set({ scale: e.target.checked })}
        />
        Scale the content to the new size
      </label>
      <p className="text-xs text-muted-foreground">
        {options.scale
          ? "Pages stay vector, so text stays selectable."
          : "Content keeps its size and sits centred on the new sheet."}
      </p>
      {sizes && sizes.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">
            {picked.size === 0
              ? "All pages are resized"
              : `Only ${picked.size} selected page${picked.size === 1 ? " is" : "s are"} resized`}
          </p>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-ink/10 bg-secondary p-3">
            <PageGrid
              session={session}
              sizes={sizes}
              pages={gridPages}
              selected={picked}
              onSelected={(next) => {
                setPicked(next);
                set({
                  pages:
                    next.size === 0
                      ? null
                      : [...next].map(Number).sort((a, b) => a - b),
                });
              }}
              disabled={disabled}
              ariaLabel="Pages. Select the ones to resize; none selected means all."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
