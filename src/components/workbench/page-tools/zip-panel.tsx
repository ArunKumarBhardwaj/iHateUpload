"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileItem } from "@/lib/job";
import { planZipEntries, type ZipLevel } from "@/lib/pdf-zip";
import type { ToolOptions } from "@/lib/tool-options";

const BTN = "h-10 sm:h-7";
const LIST_LIMIT = 8;

type ZipOptions = Extract<ToolOptions, { kind: "pdf-to-zip" }>;

const LEVELS: [ZipLevel, string][] = [
  ["store", "None"],
  ["fast", "Fast"],
  ["balanced", "Balanced"],
  ["max", "Max"],
];

export function ZipPanel({
  options,
  onOptions,
  files,
  filePages,
  disabled,
}: {
  options: ZipOptions;
  onOptions: (next: ToolOptions) => void;
  files: FileItem[];
  filePages: number[];
  disabled: boolean;
}) {
  const set = (patch: Partial<Omit<ZipOptions, "kind">>) => onOptions({ ...options, ...patch });
  const splitting = options.split >= 1;
  const mode = !splitting ? "whole" : options.split === 1 ? "pages" : "chunks";
  const known = files.length > 0 && filePages.length === files.length && filePages.every((n) => n > 0);
  const plan = known
    ? planZipEntries(
        files.map((f, i) => ({ name: f.name, pages: filePages[i] })),
        options,
      )
    : null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">What goes in the ZIP</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["whole", "Whole files", 0],
              ["pages", "One PDF per page", 1],
              ["chunks", "Every N pages", Math.max(2, options.split)],
            ] as const
          ).map(([id, title, split]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              className={BTN}
              variant={mode === id ? "default" : "outline"}
              aria-pressed={mode === id}
              disabled={disabled}
              onClick={() => set({ split })}
            >
              {title}
            </Button>
          ))}
        </div>
        {mode === "chunks" && (
          <label className="flex items-center gap-2 text-sm text-ink">
            Pages per PDF
            <Input
              type="number"
              inputMode="numeric"
              min={2}
              max={9999}
              className="h-10 w-20 sm:h-8"
              value={options.split}
              disabled={disabled}
              onChange={(e) => {
                const n = Math.floor(Number(e.target.value));
                if (Number.isFinite(n)) set({ split: Math.min(9999, Math.max(2, n)) });
              }}
            />
          </label>
        )}
        {!splitting && (
          <p className="text-xs text-muted-foreground">Each PDF is stored byte for byte, exactly as you added it.</p>
        )}
      </div>

      <div className="space-y-1">
        <label htmlFor="zip-template" className="text-sm font-medium text-ink">
          File name pattern
        </label>
        <Input
          id="zip-template"
          value={options.template}
          disabled={disabled}
          placeholder="{name}"
          onChange={(e) => set({ template: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          {"{name}"} original name, {"{index}"} file number, {"{part}"} part number, {"{from}"} and {"{to}"} page range. .pdf is added for you.
        </p>
      </div>

      <div className="space-y-1">
        <label htmlFor="zip-folder" className="text-sm font-medium text-ink">
          Folder inside the ZIP (optional)
        </label>
        <Input
          id="zip-folder"
          value={options.folder}
          disabled={disabled}
          placeholder="my-documents"
          onChange={(e) => set({ folder: e.target.value })}
        />
      </div>

      {splitting && (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="size-4"
            checked={options.fileFolders}
            disabled={disabled}
            onChange={(e) => set({ fileFolders: e.target.checked })}
          />
          Put each file&apos;s pages in a folder named after it
        </label>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">ZIP compression</p>
        <div className="flex flex-wrap gap-2">
          {LEVELS.map(([id, title]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              className={BTN}
              variant={options.level === id ? "default" : "outline"}
              aria-pressed={options.level === id}
              disabled={disabled}
              onClick={() => set({ level: id })}
            >
              {title}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="zip-name" className="text-sm font-medium text-ink">
          ZIP file name
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="zip-name"
            value={options.zipName}
            disabled={disabled}
            onChange={(e) => set({ zipName: e.target.value })}
          />
          <span className="text-sm text-muted-foreground">.zip</span>
        </div>
      </div>

      <div className="space-y-1" aria-live="polite">
        <p className="text-sm font-medium text-ink">
          {plan ? `${plan.length} ${plan.length === 1 ? "file" : "files"} in the ZIP` : "Inside the ZIP"}
        </p>
        {plan && (
          <ul className="space-y-0.5 text-xs text-muted-foreground" data-testid="zip-entries">
            {plan.slice(0, LIST_LIMIT).map((entry) => (
              <li key={entry.path} className="truncate">
                {entry.path}
              </li>
            ))}
            {plan.length > LIST_LIMIT && <li>… and {plan.length - LIST_LIMIT} more</li>}
          </ul>
        )}
      </div>
    </div>
  );
}
