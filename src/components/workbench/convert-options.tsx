"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { FileItem } from "@/lib/job";
import type { DocConvertOptions, DocFont, DocMargin, DocPaper } from "@/lib/doc-render/options";
import type { ToolOptions } from "@/lib/tool-options";

type Opts = Extract<ToolOptions, { kind: "convert-doc" }>;

const BTN = "h-10 sm:h-7";

export function convertDocHint(o: Opts): string {
  switch (o.src) {
    case "markdown":
      return "Headings, lists, code, quotes and tables are drawn as real, selectable text. Images embedded as data are kept.";
    case "excel":
      return "Every sheet you pick, with numbers right-aligned as Excel shows them and the header row repeated on each page.";
    case "csv":
      return "A table with the header row repeated on every page. The text stays selectable.";
    case "html":
      return "Basic CSS is applied: colours, backgrounds, borders, fonts and alignment. Scripts do not run, and nothing is fetched.";
  }
}

function Group<T extends string>({
  label,
  value,
  items,
  onPick,
  disabled,
}: {
  label: string;
  value: T;
  items: readonly (readonly [T, string])[];
  onPick: (v: T) => void;
  disabled: boolean;
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

function Check({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input
        type="checkbox"
        className="mt-0.5 size-4"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

export function ConvertOptions({
  options,
  onOptions,
  disabled,
  files,
}: {
  options: Opts;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
  files?: FileItem[];
}) {
  const set = (patch: Partial<DocConvertOptions>) => onOptions({ ...options, ...patch });
  const first = files?.[0]?.file;
  const [names, setNames] = useState<string[]>([]);
  useEffect(() => {
    if (options.src !== "excel" || !first) return;
    let live = true;
    void first
      .arrayBuffer()
      .then(async (buf) => (await import("@/lib/doc-render/excel")).readSheetNames(buf))
      .then((n) => live && setNames(n))
      .catch(() => live && setNames([]));
    return () => {
      live = false;
    };
  }, [first, options.src]);
  const shown = options.src === "excel" && first ? names : [];

  const toggleSheet = (name: string) => {
    const cur = options.sheets.length ? options.sheets : names;
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name];
    set({ sheets: next.length === names.length ? [] : next });
  };

  return (
    <div className="space-y-4">
      {shown.length > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Sheets</p>
          <div className="flex flex-wrap gap-2">
            {shown.map((name) => {
              const on = options.sheets.length === 0 || options.sheets.includes(name);
              return (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  className={BTN}
                  variant={on ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => toggleSheet(name)}
                >
                  {name}
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
      <Group<DocPaper>
        label="Paper"
        value={options.paper}
        disabled={disabled}
        onPick={(paper) => set({ paper })}
        items={[
          ["a4", "A4"],
          ["letter", "Letter"],
          ["legal", "Legal"],
          ["a3", "A3"],
        ]}
      />
      <Group<"p" | "l">
        label="Orientation"
        value={options.landscape ? "l" : "p"}
        disabled={disabled}
        onPick={(v) => set({ landscape: v === "l" })}
        items={[
          ["p", "Portrait"],
          ["l", "Landscape"],
        ]}
      />
      <Group<DocMargin>
        label="Margins"
        value={options.margin}
        disabled={disabled}
        onPick={(margin) => set({ margin })}
        items={[
          ["narrow", "Narrow"],
          ["normal", "Normal"],
          ["wide", "Wide"],
        ]}
      />
      {options.src === "markdown" ? (
        <>
          <Group<DocFont>
            label="Typeface"
            value={options.font}
            disabled={disabled}
            onPick={(font) => set({ font })}
            items={[
              ["sans", "Sans"],
              ["serif", "Serif"],
              ["mono", "Mono"],
            ]}
          />
          <Group<string>
            label="Text size"
            value={String(options.fontSize)}
            disabled={disabled}
            onPick={(v) => set({ fontSize: Number(v) })}
            items={[
              ["9", "9 pt"],
              ["11", "11 pt"],
              ["13", "13 pt"],
              ["15", "15 pt"],
            ]}
          />
          <Check label="Table of contents with page numbers" checked={options.toc} disabled={disabled} onChange={(toc) => set({ toc })} />
          <Check label="Number the headings (1, 1.1, 1.2)" checked={options.numberHeadings} disabled={disabled} onChange={(numberHeadings) => set({ numberHeadings })} />
        </>
      ) : null}
      {options.src === "excel" || options.src === "csv" ? (
        <>
          <Check
            label={options.src === "excel" ? "Print the sheet name above each table" : "Print the file name above the table"}
            checked={options.title}
            disabled={disabled}
            onChange={(title) => set({ title })}
          />
          <Check label="Page footer with file name and page numbers" checked={options.footer} disabled={disabled} onChange={(footer) => set({ footer })} />
          <Check label="Shade every other row" checked={options.zebra} disabled={disabled} onChange={(zebra) => set({ zebra })} />
        </>
      ) : null}
      {options.src === "excel" ? (
        <Group<"shrink" | "wrap">
          label="Wide sheets"
          value={options.fit}
          disabled={disabled}
          onPick={(fit) => set({ fit })}
          items={[
            ["shrink", "Shrink to fit the width"],
            ["wrap", "Keep size, wrap text"],
          ]}
        />
      ) : null}
    </div>
  );
}
