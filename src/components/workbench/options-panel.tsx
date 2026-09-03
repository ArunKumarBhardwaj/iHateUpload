"use client";

import { ArrowDown, ArrowUp, FileText, RotateCcw, X } from "lucide-react";

import { Thumbnail } from "@/components/workbench/thumbnail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PENDING_THUMBNAIL,
  UNAVAILABLE_THUMBNAIL,
  type ThumbnailState,
} from "@/lib/preview";
import {
  COMPRESS_LEVELS,
  parsePageRange,
  RESIZE_MAX,
  RESIZE_MIN,
  RESIZE_PRESETS,
  type ToolOptions,
} from "@/lib/tool-options";
import { PAGE_THUMBNAIL_LIMIT } from "@/lib/use-previews";
import { cn } from "@/lib/utils";

/** Same reasoning as the file cards: phones need a bigger hit area than 28px. */
const OPTION_BUTTON = "h-10 sm:h-7";
const PAGE_BUTTON = "size-10 sm:size-7";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-ink" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** Page grids need the canvas width; narrow controls sit in the sidebar. */
export function optionsNeedCanvas(options: ToolOptions): boolean {
  return options.kind === "organize";
}

/** One sentence telling the reader what the panel next to it is asking for. */
export function optionsHint(options: ToolOptions, actionLabel: string): string {
  switch (options.kind) {
    case "none":
      return `Nothing to set up. Press ${actionLabel} and the work runs right here in this tab.`;
    case "password":
      return "Type the password this PDF was locked with. It never leaves the tab.";
    case "password-confirm":
      return "Choose a password. You will need it every time you open the PDF.";
    case "rotate":
      return "Pick how far to turn every page in the document.";
    case "resize":
      return "Set the longest edge in pixels. The aspect ratio stays as it is.";
    case "organize":
      return "Reorder or drop pages in the grid, then save the new PDF.";
    case "compress":
      return "Light keeps text selectable. Medium and Smallest may flatten scans to shrink them further.";
    case "extract":
      return "Type the pages to keep. The new file is only those pages, in that order.";
  }
}

/**
 * Renders the controls the current options carry. Switching on the options
 * rather than on `tool.ui` keeps the two from ever disagreeing.
 */
export function OptionsPanel({
  options,
  onOptions,
  confirmPassword,
  onConfirmPassword,
  pagePreviews,
  pageCount,
  disabled,
}: {
  options: ToolOptions;
  onOptions: (next: ToolOptions) => void;
  confirmPassword: string;
  onConfirmPassword: (next: string) => void;
  pagePreviews: ReadonlyMap<number, ThumbnailState>;
  pageCount: number;
  disabled: boolean;
}) {
  switch (options.kind) {
    case "none":
      return null;

    case "password":
      return (
        <Field label="Password" htmlFor="pdf-password">
          <Input
            id="pdf-password"
            type="password"
            autoComplete="current-password"
            value={options.password}
            disabled={disabled}
            onChange={(e) =>
              onOptions({ kind: "password", password: e.target.value })
            }
            placeholder="PDF password"
          />
        </Field>
      );

    case "password-confirm": {
      const mismatch =
        options.password.length > 0 &&
        confirmPassword.length > 0 &&
        options.password !== confirmPassword;
      return (
        <div className="space-y-3">
          <Field label="Password" htmlFor="pdf-password">
            <Input
              id="pdf-password"
              type="password"
              autoComplete="new-password"
              value={options.password}
              disabled={disabled}
              onChange={(e) =>
                onOptions({
                  kind: "password-confirm",
                  password: e.target.value,
                })
              }
              placeholder="Choose a password"
            />
          </Field>
          <Field label="Confirm password" htmlFor="pdf-password-confirm">
            <Input
              id="pdf-password-confirm"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              disabled={disabled}
              onChange={(e) => onConfirmPassword(e.target.value)}
              placeholder="Repeat password"
              aria-invalid={mismatch}
            />
          </Field>
          {mismatch && (
            <p className="text-sm text-destructive">Passwords do not match.</p>
          )}
        </div>
      );
    }

    case "rotate":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Rotate every page by</p>
          <div className="flex flex-wrap gap-2">
            {([90, 180, 270] as const).map((degrees) => (
              <Button
                key={degrees}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.degrees === degrees ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ kind: "rotate", degrees })}
              >
                {degrees}°
              </Button>
            ))}
          </div>
        </div>
      );

    case "compress":
      return (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-ink">Compression</legend>
          {COMPRESS_LEVELS.map((level) => {
            const selected = options.level === level.id;
            return (
              <label
                key={level.id}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5",
                  selected
                    ? "border-signal bg-signal/5"
                    : "border-ink/10 bg-background/70",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="radio"
                  name="compress-level"
                  className="mt-1"
                  checked={selected}
                  disabled={disabled}
                  onChange={() =>
                    onOptions({ kind: "compress", level: level.id })
                  }
                />
                <span className="min-w-0">
                  <span className="text-sm font-medium text-ink">
                    {level.title}
                    {level.recommended ? (
                      <span className="ml-2 text-xs font-semibold text-lagoon">
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {level.result} · {level.use}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
      );

    case "extract": {
      const kept = parsePageRange(options.range, options.pageCount);
      return (
        <div className="space-y-3">
          <Field label="Pages to keep" htmlFor="extract-range">
            <Input
              id="extract-range"
              value={options.range}
              disabled={disabled || options.pageCount === 0}
              onChange={(e) =>
                onOptions({
                  kind: "extract",
                  range: e.target.value,
                  pageCount: options.pageCount,
                })
              }
              placeholder={
                options.pageCount > 0
                  ? `e.g. 1-${options.pageCount}`
                  : "Reading pages…"
              }
              inputMode="text"
              autoComplete="off"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            {options.pageCount === 0
              ? "Reading the pages in this PDF…"
              : kept.length === 0
                ? `This PDF has ${options.pageCount} pages. Use 1-3, 7 or all.`
                : `Keeping ${kept.length} of ${options.pageCount} pages.`}
          </p>
        </div>
      );
    }

    case "resize":
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">Max edge (longest side)</p>
          <div className="flex flex-wrap gap-2">
            {RESIZE_PRESETS.map((maxEdge) => (
              <Button
                key={maxEdge}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.maxEdge === maxEdge ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ kind: "resize", maxEdge })}
              >
                {maxEdge}px
              </Button>
            ))}
          </div>
          <Field label="Custom pixels" htmlFor="resize-max-edge">
            <Input
              id="resize-max-edge"
              type="number"
              inputMode="numeric"
              min={RESIZE_MIN}
              max={RESIZE_MAX}
              step={1}
              value={options.maxEdge}
              disabled={disabled}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next)) {
                  onOptions({ kind: "resize", maxEdge: Math.round(next) });
                }
              }}
            />
          </Field>
        </div>
      );

    case "organize": {
      const { pageOrder } = options;
      const setOrder = (next: number[]) =>
        onOptions({ kind: "organize", pageOrder: next });
      const move = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= pageOrder.length) return;
        const next = [...pageOrder];
        [next[index], next[target]] = [next[target], next[index]];
        setOrder(next);
      };
      const edited =
        pageOrder.length !== pageCount ||
        pageOrder.some((page, index) => page !== index);

      if (pageCount === 0) {
        return (
          <p className="text-sm text-muted-foreground">
            Reading the pages in this PDF…
          </p>
        );
      }

      return (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">
              {pageOrder.length === pageCount
                ? `${pageCount} pages`
                : `Keeping ${pageOrder.length} of ${pageCount} pages`}
            </p>
            {edited && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className={OPTION_BUTTON}
                disabled={disabled}
                onClick={() =>
                  setOrder(Array.from({ length: pageCount }, (_, i) => i))
                }
              >
                <RotateCcw />
                Reset order
              </Button>
            )}
          </div>

          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {pageOrder.map((page, index) => (
              <li
                key={`${page}-${index}`}
                className="flex flex-col gap-1.5 rounded-lg border border-ink/10 bg-background/70 p-2"
              >
                <Thumbnail
                  state={
                    pagePreviews.get(page) ??
                    (page < PAGE_THUMBNAIL_LIMIT
                      ? PENDING_THUMBNAIL
                      : UNAVAILABLE_THUMBNAIL)
                  }
                  alt={`Page ${page + 1}`}
                  icon={<FileText className="size-4" />}
                  className="h-28 w-full bg-muted/40 sm:h-32"
                />
                <p className="text-[11px] font-medium text-ink">
                  Page {page + 1}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className={PAGE_BUTTON}
                    aria-label={`Move page ${page + 1} earlier`}
                    disabled={disabled || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className={PAGE_BUTTON}
                    aria-label={`Move page ${page + 1} later`}
                    disabled={disabled || index === pageOrder.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className={cn(PAGE_BUTTON, "ml-auto")}
                    aria-label={`Remove page ${page + 1}`}
                    disabled={disabled || pageOrder.length <= 1}
                    onClick={() =>
                      setOrder(pageOrder.filter((_, i) => i !== index))
                    }
                  >
                    <X />
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          {pageCount > PAGE_THUMBNAIL_LIMIT && (
            <p className="text-xs text-muted-foreground">
              Thumbnails stop after page {PAGE_THUMBNAIL_LIMIT}. Later pages
              still reorder and export normally.
            </p>
          )}
        </div>
      );
    }
  }
}
