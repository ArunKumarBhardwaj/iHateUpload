"use client";

import { useRef } from "react";
import { ArrowDown, ArrowUp, FileText, RotateCcw, X } from "lucide-react";

import { BatesControls } from "@/components/workbench/bates-controls";
import { MetadataEditor } from "@/components/workbench/metadata-editor";
import { SplitExtras } from "@/components/workbench/split-extras";
import { ScanCapture } from "@/components/workbench/scan-capture";
import { HeaderFooterPanel } from "@/components/workbench/header-footer-panel";
import {
  ExtractImagesPanel,
  ExtractTextPanel,
  ProtectPanel,
  UnlockPanel,
} from "@/components/workbench/security-panels";
import { Thumbnail } from "@/components/workbench/thumbnail";
import { WatermarkPreview } from "@/components/workbench/watermark-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileItem } from "@/lib/job";
import { JPEG_QUALITIES } from "@/lib/pdf-image";
import {
  PENDING_THUMBNAIL,
  UNAVAILABLE_THUMBNAIL,
  type ThumbnailState,
} from "@/lib/preview";
import {
  ANNOTATE_POSITIONS,
  COMPRESS_LEVELS,
  NUMBER_FORMATS,
  NUMBER_SIZES,
  PDF_IMAGE_DPIS,
  SPLIT_MODES,
  PDF_TARGET_KB_MAX,
  PDF_TARGET_KB_PRESETS,
  OCR_LANGUAGES,
  OCR_OUTPUTS,
  parsePageRange,
  RESIZE_MAX,
  RESIZE_MIN,
  RESIZE_PRESETS,
  TARGET_KB_MAX,
  TARGET_KB_MIN,
  TARGET_KB_PRESETS,
  type SignMode,
  WATERMARK_COLORS,
  WATERMARK_ROTATIONS,
  WATERMARK_SIZES,
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

/** Plain page numbers or Bates: same stamp engine, different counter. */
function NumberingMode({
  options,
  onOptions,
  disabled,
}: {
  options: Extract<ToolOptions, { kind: "annotate" }>;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">Numbering</p>
      <div className="flex flex-wrap gap-2">
        {(
          [
            [false, "Page numbers"],
            [true, "Bates"],
          ] as const
        ).map(([bates, title]) => (
          <Button
            key={title}
            type="button"
            size="sm"
            className={OPTION_BUTTON}
            variant={options.bates === bates ? "default" : "outline"}
            disabled={disabled}
            onClick={() =>
              options.bates === bates
                ? undefined
                : onOptions(
                    bates
                      ? { ...options, bates, position: "br", opacity: 1, color: "#14161c" }
                      : { ...options, bates, position: "footer", opacity: 0.9 },
                  )
            }
          >
            {title}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Page grids need the canvas width; narrow controls sit in the sidebar. */
export function optionsNeedCanvas(options: ToolOptions): boolean {
  return (
    options.kind === "organize" ||
    options.kind === "sign" ||
    options.kind === "edit" ||
    options.kind === "crop" ||
    options.kind === "image-crop" ||
    options.kind === "redact"
  );
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
    case "protect":
      return "Choose what readers may do once they open the file. Everything is allowed unless you untick it.";
    case "unlock":
      return options.lock === "restricted"
        ? "This PDF opens without a password. One click writes a copy with the limits removed."
        : "Type the password this PDF was locked with. It never leaves the tab.";
    case "extract-images":
      return "Pick the pictures you want. JPEGs are saved exactly as they sit in the PDF.";
    case "extract-text":
      return "Selectable text is copied as it is. Scanned pages can be read with OCR.";
    case "rotate":
      return "Turn the pages, mirror them, or both. Leave the pages box empty for all of them.";
    case "split":
      return options.mode === "bookmarks"
        ? "Cut at the PDF's own bookmarks. The files below are exactly what you will get."
        : options.mode === "text"
          ? "Start a new file at every page that contains your text. The files below update as you type."
          : "Pick how to cut the PDF. Each piece is its own file.";
    case "metadata":
      return "Every property the PDF carries, ready to edit or clear. Nothing leaves this tab.";
    case "pdf-image":
      return "Higher DPI is sharper and bigger. Leave the pages box empty for every page.";
    case "pdf-to-excel":
      return options.layout === "tables"
        ? "Each table becomes a sheet, named from the heading above it. Numbers, dates and percentages become real cells. Pages with no text are read with OCR."
        : options.layout === "pages"
          ? "Each page becomes a sheet, with its text and tables in the order they appear. Pages with no text are read with OCR."
          : "Every table goes on one sheet, one under another, each under its title. Pages with no text are read with OCR.";
    case "pdf-to-word":
      return options.mode === "editable"
        ? "Paragraphs, headings, lists, tables and pictures become real Word content. Pages with no text are read with OCR."
        : options.mode === "exact"
          ? "Every block sits in a Word text box at its place on the page. It looks the same and the text stays editable, but it does not reflow."
          : "Each page becomes one picture in the Word file. It looks the same, but the text cannot be edited.";
    case "resize":
      return "Set the longest edge in pixels. The aspect ratio stays as it is.";
    case "organize":
      return "Reorder or drop pages in the grid, then save the new PDF.";
    case "compress":
      return "Every level keeps text selectable. Smallest may flatten scanned pages that have no text to shrink them further.";
    case "extract":
      return "Type the pages to keep. The new file is only those pages, in that order.";
    case "sign":
      return "Draw, type, or stamp a signature, then drag it onto the page.";
    case "edit":
      return "Click a line to change it. Scans are read with OCR. Old letters are covered, not rewritten.";
    case "crop":
      return "Drag the box to the area every page should keep.";
    case "redact":
      return "Scan for personal info or draw boxes over the text. Those pixels are burned out, not covered.";
    case "compare":
      return "Add two PDFs. First is the left file. The text diff is the result.";
    case "header-footer":
      return "Left, center, and right. {page} {pages} {date} expand on each page.";
    case "insert-blank":
      return "Insert one blank page after the page number you type. 0 puts it first.";
    case "invert":
      return "Invert flips every pixel. Grayscale keeps the layout, drops the color.";
    case "nup":
      return "How many pages to print on each sheet.";
    case "page-size":
      return "Fit fills the sheet and may clip. Letterbox keeps the whole page.";
    case "annotate":
      return options.variant === "numbers"
        ? options.bates
          ? "Bates numbers run on through every file, in list order, as real selectable text."
          : "Pick where the numbers sit, how they read, and where counting starts."
        : "Type the stamp, then set how it looks. The preview shows page 1. It is drawn in this tab as real text.";
    case "ocr":
      return "Tesseract reads each page in this tab. Hindi keeps its letters. Pages that already have words can be copied as-is. Slow on long scans.";
    case "ask":
      return "The PDF stays here. Only extracted text is sent with your question.";
    case "scan":
      return "Use the camera or drop a photo. Each capture becomes a page.";
    case "image-crop":
      return "Drag the box on the photo. Only that area is kept.";
    case "image-turn":
      return "Turn the photo or flip it. The file stays in this tab.";
    case "target-kb":
      return "Pick a KB cap. The result is a JPEG at or under that size.";
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
  firstPage,
  disabled,
  onAddFiles,
  files,
  filePages,
}: {
  options: ToolOptions;
  onOptions: (next: ToolOptions) => void;
  confirmPassword: string;
  onConfirmPassword: (next: string) => void;
  pagePreviews: ReadonlyMap<number, ThumbnailState>;
  pageCount: number;
  /** Page 1 thumbnail, drawn under the live watermark preview. */
  firstPage?: ThumbnailState;
  disabled: boolean;
  onAddFiles?: (files: File[]) => void;
  /** Selected files, in order; the split preview and metadata editor read them. */
  files?: FileItem[];
  /** Page count of each selected file, 0 while unknown. */
  filePages?: number[];
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

    case "protect":
      return (
        <ProtectPanel
          options={options}
          onOptions={onOptions}
          confirmPassword={confirmPassword}
          onConfirmPassword={onConfirmPassword}
          disabled={disabled}
        />
      );

    case "unlock":
      return (
        <UnlockPanel
          options={options}
          onOptions={onOptions}
          disabled={disabled}
          files={files}
        />
      );

    case "extract-images":
      return (
        <ExtractImagesPanel
          options={options}
          onOptions={onOptions}
          disabled={disabled}
        />
      );

    case "extract-text":
      return (
        <ExtractTextPanel
          options={options}
          onOptions={onOptions}
          disabled={disabled}
        />
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
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Rotate by</p>
            <div className="flex flex-wrap gap-2">
              {([0, 90, 180, 270] as const).map((degrees) => (
                <Button
                  key={degrees}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.degrees === degrees ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, degrees })}
                >
                  {degrees === 0 ? "No turn" : `${degrees}°`}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Mirror</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["none", "Off"],
                  ["h", "Left-right"],
                  ["v", "Top-bottom"],
                  ["hv", "Both"],
                ] as const
              ).map(([flip, label]) => (
                <Button
                  key={flip}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.flip === flip ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, flip })}
                >
                  {label}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Mirrors the page after any turn. Text stays text, not a picture.
            </p>
          </div>
          <Field label="Pages" htmlFor="rotate-range">
            <Input
              id="rotate-range"
              value={options.range}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, range: e.target.value })}
              placeholder="All pages, or e.g. 1-3, 7"
              inputMode="text"
              autoComplete="off"
            />
          </Field>
        </div>
      );

    case "split":
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Split</p>
            <div className="flex flex-wrap gap-2">
              {SPLIT_MODES.map((mode) => (
                <Button
                  key={mode.id}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.mode === mode.id ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, mode: mode.id })}
                >
                  {mode.title}
                </Button>
              ))}
            </div>
          </div>
          {options.mode === "ranges" ? (
            <Field label="Ranges, one file each" htmlFor="split-ranges">
              <Input
                id="split-ranges"
                value={options.ranges}
                disabled={disabled}
                onChange={(e) =>
                  onOptions({ ...options, ranges: e.target.value })
                }
                placeholder="e.g. 1-3, 4-6, 7-"
                inputMode="text"
                autoComplete="off"
              />
            </Field>
          ) : null}
          <SplitExtras
            options={options}
            onOptions={onOptions}
            file={files?.[0]?.file}
            fileKey={files?.[0]?.id ?? ""}
            baseName={(files?.[0]?.name ?? "document").replace(/\.[^.]+$/, "")}
            disabled={disabled}
          />
          {options.mode === "size" ? (
            <Field label="Max size per part (MB)" htmlFor="split-size">
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
            </Field>
          ) : null}
        </div>
      );

    case "pdf-image":
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Format</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["jpg", "JPG"],
                  ["png", "PNG"],
                ] as const
              ).map(([format, title]) => (
                <Button
                  key={format}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.format === format ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, format })}
                >
                  {title}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Resolution</p>
            <div className="flex flex-wrap gap-2">
              {PDF_IMAGE_DPIS.map((dpi) => (
                <Button
                  key={dpi.id}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.dpi === dpi.id ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, dpi: dpi.id })}
                >
                  {dpi.title}
                </Button>
              ))}
            </div>
            {options.dpi >= 300 ? (
              <p className="text-xs text-ink/70">
                Very large pages are limited to 4096 px on a side. Any page that
                is limited is noted in the results.
              </p>
            ) : null}
          </div>
          {options.format === "jpg" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Quality</p>
              <div className="flex flex-wrap gap-2">
                {JPEG_QUALITIES.map((quality) => (
                  <Button
                    key={quality.id}
                    type="button"
                    size="sm"
                    className={OPTION_BUTTON}
                    variant={
                      options.quality === quality.id ? "default" : "outline"
                    }
                    disabled={disabled}
                    onClick={() =>
                      onOptions({ ...options, quality: quality.id })
                    }
                  >
                    {quality.title}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <Field label="Pages" htmlFor="pdf-image-range">
            <Input
              id="pdf-image-range"
              value={options.range}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, range: e.target.value })}
              placeholder="All pages, or e.g. 1-3, 7"
              inputMode="text"
              autoComplete="off"
            />
          </Field>
        </div>
      );

    case "pdf-to-word":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Layout</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["editable", "Editable text"],
                  ["exact", "Exact layout \u2014 looks identical, text in boxes"],
                  ["picture", "Page images (not editable)"],
                ] as const
              ).map(([mode, title]) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.mode === mode ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, mode })}
                >
                  {title}
                </Button>
              ))}
            </div>
          </div>
          {options.mode !== "picture" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Language of scanned pages</p>
              <div className="flex flex-wrap gap-2">
                {OCR_LANGUAGES.map((language) => (
                  <Button
                    key={language.id}
                    type="button"
                    size="sm"
                    className={OPTION_BUTTON}
                    variant={options.language === language.id ? "default" : "outline"}
                    disabled={disabled}
                    onClick={() => onOptions({ ...options, language: language.id })}
                  >
                    {language.title}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          {options.mode !== "picture" ? (
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={options.embedFonts}
                disabled={disabled}
                onChange={(event) =>
                  onOptions({ ...options, embedFonts: event.target.checked })
                }
              />
              <span>
                Embed fonts. The Word file carries the fonts from the PDF, so it
                looks right on computers that do not have them. The file gets
                bigger.
              </span>
            </label>
          ) : null}
        </div>
      );

    case "pdf-to-excel":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Format</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["xlsx", "Excel (.xlsx)"],
                  ["csv", "CSV, one file per sheet"],
                ] as const
              ).map(([format, title]) => (
                <Button
                  key={format}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.format === format ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, format })}
                >
                  {title}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Sheets</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["tables", "One per table"],
                  ["pages", "One per page"],
                  ["one", "All on one sheet"],
                ] as const
              ).map(([layout, title]) => (
                <Button
                  key={layout}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.layout === layout ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, layout })}
                >
                  {title}
                </Button>
              ))}
            </div>
          </div>
          <Field label="Pages" htmlFor="pdf-excel-range">
            <Input
              id="pdf-excel-range"
              value={options.range}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, range: e.target.value })}
              placeholder="All pages, or e.g. 1-3, 7"
              inputMode="text"
              autoComplete="off"
            />
          </Field>
          <div className="space-y-2">
            {(
              [
                ["includeText", "Keep the text outside the tables", options.layout !== "pages" ? "A Text sheet." : "In order, between the tables."],
                ["typed", "Numbers and dates as values", "Money, percents and dates become real cells. IDs with leading zeros stay text."],
                ["formatting", "Formatting", "Fills, borders and bold from the PDF."],
                ["freezeFilter", "Freeze header and filter", "Keeps the header in view and adds a filter."],
                ["joinPages", "Join tables across pages", "A table that carries on over the page break becomes one."],
              ] as const
            ).map(([key, title, hint]) => (
              <label key={key} className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={options[key]}
                  disabled={disabled}
                  onChange={(event) => onOptions({ ...options, [key]: event.target.checked })}
                />
                <span>
                  {title}. <span className="text-muted-foreground">{hint}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Language of scanned pages</p>
            <div className="flex flex-wrap gap-2">
              {OCR_LANGUAGES.map((language) => (
                <Button
                  key={language.id}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.language === language.id ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, language: language.id })}
                >
                  {language.title}
                </Button>
              ))}
            </div>
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
                    : "border-ink/10 bg-card",
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
                    onOptions({ ...options, level: level.id })
                  }
                />
                <span className="min-w-0">
                  <span className="text-sm font-medium text-ink">
                    {level.title}
                    {level.recommended ? (
                      <span className="ml-2 text-xs font-semibold text-signal">
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
          <div className="space-y-2 pt-3">
            <p className="text-sm font-medium text-ink">Target size</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.targetKb === null ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ ...options, targetKb: null })}
              >
                Off
              </Button>
              {PDF_TARGET_KB_PRESETS.map((targetKb) => (
                <Button
                  key={targetKb}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.targetKb === targetKb ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, targetKb })}
                >
                  {targetKb >= 1024 ? `${targetKb / 1024} MB` : `${targetKb} KB`}
                </Button>
              ))}
            </div>
            {options.targetKb !== null ? (
              <Field label="Custom KB" htmlFor="pdf-target-kb">
                <Input
                  id="pdf-target-kb"
                  type="number"
                  min={TARGET_KB_MIN}
                  max={PDF_TARGET_KB_MAX}
                  value={options.targetKb}
                  disabled={disabled}
                  onChange={(e) =>
                    onOptions({ ...options, targetKb: Number(e.target.value) })
                  }
                />
              </Field>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Steps down image quality until the PDF fits, text untouched.
            </p>
          </div>
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
                className="flex flex-col gap-1.5 rounded-lg border border-ink/10 bg-card p-2"
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

    case "sign":
      return (
        <SignControls
          options={options}
          onOptions={onOptions}
          pageCount={pageCount}
          disabled={disabled}
        />
      );

    case "edit":
      return null;

    case "crop":
      return (
        <p className="text-sm text-muted-foreground">
          The same crop applies to every page. Drag the box on the page.
        </p>
      );

    case "redact": {
      const kept = options.findings.filter((f) => f.accepted).length;
      const total = options.boxes.length + kept;
      return (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {total === 0
              ? "Scan for personal info or drag on the page. Those pixels are destroyed."
              : `${total} area${total === 1 ? "" : "s"} will be burned out (${kept} found, ${options.boxes.length} drawn).`}
          </p>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={options.stripMeta}
              disabled={disabled}
              onChange={(e) =>
                onOptions({ ...options, stripMeta: e.target.checked })
              }
            />
            Clear title, author and other file info
          </label>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={options.removeHidden}
              disabled={disabled}
              onChange={(e) =>
                onOptions({ ...options, removeHidden: e.target.checked })
              }
            />
            Remove invisible text on the other pages
          </label>
        </div>
      );
    }

    case "compare":
      return (
        <p className="text-sm text-muted-foreground">
          Pages stay in lockstep. Compare writes a line diff of the selectable text.
        </p>
      );

    case "header-footer":
      return (
        <HeaderFooterPanel
          options={options}
          onOptions={onOptions}
          disabled={disabled}
          firstPage={firstPage}
          filename={(files?.[0]?.name ?? "document.pdf").replace(/\.pdf$/i, "")}
          pageCount={filePages?.[0] ?? 0}
        />
      );

    case "insert-blank":
      return (
        <Field label="Insert after page" htmlFor="insert-after">
          <Input
            id="insert-after"
            type="number"
            min={0}
            max={pageCount > 0 ? pageCount : undefined}
            value={options.afterPage}
            disabled={disabled}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next)) return;
              onOptions({
                kind: "insert-blank",
                afterPage: Math.max(0, Math.round(next)),
              });
            }}
          />
          <p className="pt-1 text-xs text-muted-foreground">
            {pageCount > 0
              ? `This PDF has ${pageCount} pages. 0 inserts at the start.`
              : "0 inserts at the start."}
          </p>
        </Field>
      );

    case "invert":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Mode</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["invert", "Invert"],
                ["grayscale", "Grayscale"],
              ] as const
            ).map(([mode, title]) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.mode === mode ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ kind: "invert", mode })}
              >
                {title}
              </Button>
            ))}
          </div>
        </div>
      );

    case "nup":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Pages per sheet</p>
          <div className="flex flex-wrap gap-2">
            {([2, 4, 9] as const).map((n) => (
              <Button
                key={n}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.n === n ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ kind: "nup", n })}
              >
                {n}-up
              </Button>
            ))}
          </div>
        </div>
      );

    case "page-size":
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium text-ink">Sheet</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["a4", "A4"],
                ["letter", "Letter"],
              ] as const
            ).map(([size, title]) => (
              <Button
                key={size}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.size === size ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ ...options, size })}
              >
                {title}
              </Button>
            ))}
          </div>
          <p className="text-sm font-medium text-ink">How to fit</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["letterbox", "Letterbox"],
                ["fit", "Fit"],
              ] as const
            ).map(([fit, title]) => (
              <Button
                key={fit}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.fit === fit ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ ...options, fit })}
              >
                {title}
              </Button>
            ))}
          </div>
        </div>
      );

    case "annotate":
      if (options.variant === "watermark") {
        const choice = (active: boolean) => (active ? "default" : "outline");
        const presetRotation = (
          WATERMARK_ROTATIONS as readonly number[]
        ).includes(options.rotation);
        return (
          <div className="space-y-4">
            <Field label="Stamp" htmlFor="watermark-text">
              <Input
                id="watermark-text"
                value={options.text}
                disabled={disabled}
                onChange={(e) =>
                  onOptions({ ...options, text: e.target.value })
                }
              />
            </Field>
            <WatermarkPreview thumbnail={firstPage} options={options} />
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Layout</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ["single", "One stamp"],
                    ["tiled", "Tiled"],
                  ] as const
                ).map(([layout, title]) => (
                  <Button
                    key={layout}
                    type="button"
                    size="sm"
                    className={OPTION_BUTTON}
                    variant={choice(options.layout === layout)}
                    disabled={disabled}
                    onClick={() => onOptions({ ...options, layout })}
                  >
                    {title}
                  </Button>
                ))}
              </div>
            </div>
            {options.layout === "single" ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-ink">Position</p>
                <div className="flex flex-wrap gap-2">
                  {ANNOTATE_POSITIONS.filter(
                    (position) => position.id !== "diagonal",
                  ).map((position) => (
                    <Button
                      key={position.id}
                      type="button"
                      size="sm"
                      className={OPTION_BUTTON}
                      variant={choice(options.position === position.id)}
                      disabled={disabled}
                      onClick={() =>
                        onOptions({ ...options, position: position.id })
                      }
                    >
                      {position.title}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Size</p>
              <div className="flex flex-wrap gap-2">
                {WATERMARK_SIZES.map((size) => (
                  <Button
                    key={size.id}
                    type="button"
                    size="sm"
                    className={OPTION_BUTTON}
                    variant={choice(options.size === size.id)}
                    disabled={disabled}
                    onClick={() => onOptions({ ...options, size: size.id })}
                  >
                    {size.title}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Angle</p>
              <div className="flex flex-wrap items-center gap-2">
                {WATERMARK_ROTATIONS.map((turn) => (
                  <Button
                    key={turn}
                    type="button"
                    size="sm"
                    className={OPTION_BUTTON}
                    variant={choice(options.rotation === turn)}
                    disabled={disabled}
                    onClick={() => onOptions({ ...options, rotation: turn })}
                  >
                    {turn}°
                  </Button>
                ))}
                <Input
                  aria-label="Custom angle in degrees"
                  className={cn(
                    "h-10 w-24 sm:h-7",
                    !presetRotation && "ring-2 ring-ink/40",
                  )}
                  type="number"
                  min={-180}
                  max={180}
                  value={options.rotation}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    onOptions({
                      ...options,
                      rotation: Math.max(-180, Math.min(180, Math.round(next))),
                    });
                  }}
                />
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-ink">Colour</p>
              <div className="flex flex-wrap items-center gap-2">
                {WATERMARK_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    aria-label={`Colour ${color}`}
                    aria-pressed={options.color === color}
                    disabled={disabled}
                    onClick={() => onOptions({ ...options, color })}
                    className={cn(
                      "size-10 rounded-full ring-1 ring-ink/20 sm:size-7",
                      options.color === color && "ring-2 ring-ink",
                    )}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <input
                  type="color"
                  aria-label="Custom colour"
                  className="h-10 w-12 cursor-pointer rounded-md sm:h-7 sm:w-10"
                  value={
                    /^#[0-9a-f]{6}$/i.test(options.color)
                      ? options.color
                      : "#6b7280"
                  }
                  disabled={disabled}
                  onChange={(e) =>
                    onOptions({ ...options, color: e.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <label
                className="flex items-center justify-between text-sm font-medium text-ink"
                htmlFor="watermark-opacity"
              >
                <span>Opacity</span>
                <span className="tabular-nums text-ink/70">
                  {Math.round(options.opacity * 100)}%
                </span>
              </label>
              <input
                id="watermark-opacity"
                type="range"
                min={10}
                max={100}
                step={5}
                className="w-full"
                value={Math.round(options.opacity * 100)}
                disabled={disabled}
                onChange={(e) =>
                  onOptions({
                    ...options,
                    opacity: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
            <Field label="Pages" htmlFor="watermark-range">
              <Input
                id="watermark-range"
                value={options.range}
                disabled={disabled}
                onChange={(e) =>
                  onOptions({ ...options, range: e.target.value })
                }
                placeholder="All pages, or e.g. 1-3, 7"
                inputMode="text"
                autoComplete="off"
              />
            </Field>
          </div>
        );
      }
      if (options.variant === "numbers" && options.bates) {
        return (
          <div className="space-y-4">
            <NumberingMode options={options} onOptions={onOptions} disabled={disabled} />
            <BatesControls
              options={options}
              onOptions={onOptions}
              disabled={disabled}
              filePages={filePages ?? []}
              firstPage={firstPage}
            />
          </div>
        );
      }
      return (
        <div className="space-y-3">
          <NumberingMode options={options} onOptions={onOptions} disabled={disabled} />
          <p className="text-sm font-medium text-ink">Position</p>
          <div className="flex flex-wrap gap-2">
            {ANNOTATE_POSITIONS.map((position) => (
              <Button
                key={position.id}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.position === position.id ? "default" : "outline"}
                disabled={disabled}
                onClick={() =>
                  onOptions({ ...options, position: position.id })
                }
              >
                {position.title}
              </Button>
            ))}
          </div>
          {options.variant === "numbers" ? (
            <>
              <p className="text-sm font-medium text-ink">Format</p>
              <div className="flex flex-wrap gap-2">
                {NUMBER_FORMATS.map((format) => (
                  <Button
                    key={format.id}
                    type="button"
                    size="sm"
                    className={OPTION_BUTTON}
                    variant={
                      options.numberFormat === format.id ? "default" : "outline"
                    }
                    disabled={disabled}
                    onClick={() =>
                      onOptions({ ...options, numberFormat: format.id })
                    }
                  >
                    {format.title}
                  </Button>
                ))}
              </div>
              <p className="text-sm font-medium text-ink">Size</p>
              <div className="flex flex-wrap gap-2">
                {NUMBER_SIZES.map((size) => (
                  <Button
                    key={size.id}
                    type="button"
                    size="sm"
                    className={OPTION_BUTTON}
                    variant={
                      options.numberSize === size.id ? "default" : "outline"
                    }
                    disabled={disabled}
                    onClick={() =>
                      onOptions({ ...options, numberSize: size.id })
                    }
                  >
                    {size.title}
                  </Button>
                ))}
              </div>
              <Field label="Start at" htmlFor="numbers-start">
                <Input
                  id="numbers-start"
                  type="number"
                  min={0}
                  value={options.startAt}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = Number(e.target.value);
                    if (!Number.isFinite(next)) return;
                    onOptions({
                      ...options,
                      startAt: Math.max(0, Math.round(next)),
                    });
                  }}
                />
              </Field>
              <label className="flex items-start gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4"
                  checked={options.skipFirst}
                  disabled={disabled}
                  onChange={(event) =>
                    onOptions({ ...options, skipFirst: event.target.checked })
                  }
                />
                <span>Leave the first page without a number.</span>
              </label>
              <Field label="Pages" htmlFor="numbers-range">
                <Input
                  id="numbers-range"
                  value={options.range}
                  disabled={disabled}
                  onChange={(e) =>
                    onOptions({ ...options, range: e.target.value })
                  }
                  placeholder="All pages, or e.g. 2-, 1-3, 7"
                  inputMode="text"
                  autoComplete="off"
                />
              </Field>
            </>
          ) : null}
        </div>
      );

    case "metadata":
      return (
        <MetadataEditor
          options={options}
          onOptions={onOptions}
          file={files?.[0]}
          disabled={disabled}
        />
      );

    case "ocr":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Language</p>
            <div className="flex flex-wrap gap-2">
              {OCR_LANGUAGES.map((language) => (
                <Button
                  key={language.id}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.language === language.id ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() =>
                    onOptions({ ...options, language: language.id })
                  }
                >
                  {language.title}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Output</p>
            <div className="flex flex-wrap gap-2">
              {OCR_OUTPUTS.map((output) => (
                <Button
                  key={output.id}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.output === output.id ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, output: output.id })}
                >
                  {output.title}
                </Button>
              ))}
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={options.skipTextPages}
              disabled={disabled}
              onChange={(event) =>
                onOptions({ ...options, skipTextPages: event.target.checked })
              }
            />
            <span>
              Skip pages that already have selectable text. Those pages are
              copied, not re-read.
            </span>
          </label>
        </div>
      );

    case "ask": {
      const suggestions = [
        "What is this document about?",
        "Summarize the key points.",
        "List names, dates, and amounts.",
        "What action is requested?",
      ];
      return (
        <div className="space-y-3">
          <Field label="Question" htmlFor="ask-question">
            <textarea
              id="ask-question"
              rows={4}
              value={options.question}
              disabled={disabled}
              onChange={(e) =>
                onOptions({ kind: "ask", question: e.target.value })
              }
              placeholder="What is this document about?"
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                type="button"
                size="sm"
                variant="outline"
                className={OPTION_BUTTON}
                disabled={disabled}
                onClick={() =>
                  onOptions({ kind: "ask", question: suggestion })
                }
              >
                {suggestion}
              </Button>
            ))}
          </div>
        </div>
      );
    }
    case "scan":
      return (
        <ScanCapture
          disabled={disabled}
          onCapture={(file) => onAddFiles?.([file])}
        />
      );

    case "image-crop":
      return (
        <p className="text-sm text-muted-foreground">
          Drag the box on the photo. Only that area is kept.
        </p>
      );

    case "image-turn":
      return (
        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Turn</p>
            <div className="flex flex-wrap gap-2">
              {([0, 90, 180, 270] as const).map((degrees) => (
                <Button
                  key={degrees}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.degrees === degrees ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, degrees })}
                >
                  {degrees}°
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Flip</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.flipH ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ ...options, flipH: !options.flipH })}
              >
                Horizontal
              </Button>
              <Button
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.flipV ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ ...options, flipV: !options.flipV })}
              >
                Vertical
              </Button>
            </div>
          </div>
        </div>
      );

    case "target-kb":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Max size</p>
          <div className="flex flex-wrap gap-2">
            {TARGET_KB_PRESETS.map((maxKb) => (
              <Button
                key={maxKb}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.maxKb === maxKb ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ kind: "target-kb", maxKb })}
              >
                {maxKb >= 1024 ? `${maxKb / 1024} MB` : `${maxKb} KB`}
              </Button>
            ))}
          </div>
          <Field label="Custom KB" htmlFor="target-kb">
            <Input
              id="target-kb"
              type="number"
              min={TARGET_KB_MIN}
              max={TARGET_KB_MAX}
              value={options.maxKb}
              disabled={disabled}
              onChange={(e) =>
                onOptions({
                  kind: "target-kb",
                  maxKb: Number(e.target.value),
                })
              }
            />
          </Field>
        </div>
      );
  }
}

function SignControls({
  options,
  onOptions,
  pageCount,
  disabled,
}: {
  options: Extract<ToolOptions, { kind: "sign" }>;
  onOptions: (next: ToolOptions) => void;
  pageCount: number;
  disabled: boolean;
}) {
  const modes: { id: SignMode; title: string }[] = [
    { id: "draw", title: "Draw" },
    { id: "type", title: "Type" },
    { id: "image", title: "Image" },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {modes.map((mode) => (
          <Button
            key={mode.id}
            type="button"
            size="sm"
            className={OPTION_BUTTON}
            variant={options.mode === mode.id ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onOptions({ ...options, mode: mode.id })}
          >
            {mode.title}
          </Button>
        ))}
      </div>
      {options.mode === "type" ? (
        <Field label="Name" htmlFor="sign-text">
          <Input
            id="sign-text"
            value={options.text}
            disabled={disabled}
            onChange={(e) => onOptions({ ...options, text: e.target.value })}
            placeholder="Your name"
          />
        </Field>
      ) : null}
      {options.mode === "image" ? (
        <Field label="Signature image" htmlFor="sign-image">
          <Input
            id="sign-image"
            type="file"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            disabled={disabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = () => {
                if (typeof reader.result === "string") {
                  onOptions({ ...options, dataUrl: reader.result });
                }
              };
              reader.readAsDataURL(file);
            }}
          />
        </Field>
      ) : null}
      {options.mode === "draw" ? (
        <DrawPad
          disabled={disabled}
          onInk={(dataUrl) => onOptions({ ...options, dataUrl })}
        />
      ) : null}
      {pageCount > 1 ? (
        <Field label="Page" htmlFor="sign-page">
          <Input
            id="sign-page"
            type="number"
            min={1}
            max={pageCount}
            value={options.box.pageIndex + 1}
            disabled={disabled}
            onChange={(e) => {
              const page = Number(e.target.value);
              if (!Number.isInteger(page)) return;
              onOptions({
                ...options,
                box: {
                  ...options.box,
                  pageIndex: Math.min(pageCount, Math.max(1, page)) - 1,
                },
              });
            }}
          />
        </Field>
      ) : null}
    </div>
  );
}

function DrawPad({
  disabled,
  onInk,
}: {
  disabled: boolean;
  onInk: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">Draw</p>
      <canvas
        ref={canvasRef}
        width={480}
        height={160}
        className="h-28 w-full touch-none rounded-xl border border-ink/15 bg-background"
        onPointerDown={(event) => {
          if (disabled) return;
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!ctx) return;
          drawing.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          const start = point(event);
          ctx.strokeStyle = "#111827";
          ctx.lineWidth = 4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
        }}
        onPointerMove={(event) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          if (!ctx) return;
          const next = point(event);
          ctx.lineTo(next.x, next.y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          const canvas = canvasRef.current;
          if (canvas) onInk(canvas.toDataURL("image/png"));
        }}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={OPTION_BUTTON}
        disabled={disabled}
        onClick={() => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext("2d");
          if (!canvas || !ctx) return;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          onInk("");
        }}
      >
        Clear
      </Button>
    </div>
  );
}
