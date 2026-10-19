"use client";

import { Button } from "@/components/ui/button";
import type { StripOptions } from "@/lib/page-tools/flatten";
import type { ToolOptions } from "@/lib/tool-options";

type FlattenOptions = Extract<ToolOptions, { kind: "flatten" }>;

const BTN = "h-10 sm:h-7";

const STRIPS: [keyof StripOptions, string, string][] = [
  ["annotations", "Annotations", "Comments, highlights, stamps and links."],
  ["forms", "Form fields", "Removes fields instead of burning their values in."],
  ["javascript", "JavaScript", "Open actions, script actions and document scripts."],
  ["attachments", "Attached files", "Embedded files and attachment icons."],
  ["metadata", "Metadata", "Title, author, dates, XMP and private data."],
];

export function FlattenPanel({
  options,
  onOptions,
  disabled,
}: {
  options: FlattenOptions;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
}) {
  const set = (patch: Partial<FlattenOptions>) => onOptions({ ...options, ...patch });
  const full = options.mode === "full";
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Flatten</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["form", "Form fields"],
              ["full", "Whole page as picture"],
            ] as const
          ).map(([mode, title]) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              className={BTN}
              variant={options.mode === mode ? "default" : "outline"}
              aria-pressed={options.mode === mode}
              disabled={disabled}
              onClick={() => set({ mode })}
            >
              {title}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {full
            ? "Every page is drawn as an image. Text can no longer be selected, searched or edited."
            : "Burns form fields into the page. Text stays selectable."}
        </p>
      </div>
      {full ? (
        <div className="max-w-xs space-y-1">
          <label htmlFor="flatten-dpi" className="text-sm font-medium text-ink">
            Resolution: {options.dpi} DPI
          </label>
          <input
            id="flatten-dpi"
            type="range"
            min={96}
            max={400}
            step={4}
            value={options.dpi}
            disabled={disabled}
            onChange={(e) => set({ dpi: Number(e.target.value) })}
            className="w-full accent-[var(--signal)]"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            {[96, 150, 200, 300, 400].map((dpi) => (
              <Button
                key={dpi}
                type="button"
                size="sm"
                className={BTN}
                variant={options.dpi === dpi ? "default" : "outline"}
                disabled={disabled}
                onClick={() => set({ dpi })}
              >
                {dpi}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Also strip</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {STRIPS.map(([key, title, hint]) => (
            <label key={key} className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--signal)]"
                checked={options.strip[key]}
                disabled={disabled}
                onChange={(e) =>
                  set({ strip: { ...options.strip, [key]: e.target.checked } })
                }
              />
              <span>
                <span className="font-medium">{title}</span>
                <span className="block text-xs text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {full ? (
          <p className="text-xs text-muted-foreground">
            A picture-only copy keeps no scripts, files or metadata. Annotations and form fields are drawn into the picture unless you strip them here.
          </p>
        ) : null}
      </div>
    </div>
  );
}
