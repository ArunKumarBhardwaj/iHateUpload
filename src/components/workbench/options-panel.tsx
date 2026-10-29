"use client";


import { ConvertOptions, convertDocHint } from "@/components/workbench/convert-options";
import { BatesControls } from "@/components/workbench/bates-controls";
import { CropPanel } from "@/components/workbench/page-tools/crop-panel";
import { FlattenPanel } from "@/components/workbench/page-tools/flatten-panel";
import { InvertPanel } from "@/components/workbench/page-tools/invert-panel";
import { RotatePanel } from "@/components/workbench/page-tools/rotate-panel";
import { OrganizePanel } from "@/components/workbench/page-tools/organize-panel";
import { PageSizePanel } from "@/components/workbench/page-tools/page-size-panel";
import { NupPanel } from "@/components/workbench/page-tools/nup-panel";
import { ZipPanel } from "@/components/workbench/page-tools/zip-panel";
import { SUMMARY_LENGTHS } from "@/lib/summarize/summary";
import { TARGET_LANGUAGES } from "@/lib/translate/languages";
import { MixPanel } from "@/components/workbench/page-tools/mix-panel";
import { MetadataEditor } from "@/components/workbench/metadata-editor";
import { SplitOptionsPanel } from "@/components/workbench/split-options";
import { ScanCapture } from "@/components/workbench/scan-capture";
import { ScanSettings } from "@/components/workbench/scan-settings";
import { HeaderFooterPanel } from "@/components/workbench/header-footer-panel";
import {
  ExtractImagesPanel,
  ExtractTextPanel,
  ProtectPanel,
  UnlockPanel,
} from "@/components/workbench/security-panels";
import { WatermarkPreview } from "@/components/workbench/watermark-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileItem } from "@/lib/job";
import { JPEG_QUALITIES } from "@/lib/pdf-image";
import {
  ANNOTATE_POSITIONS,
  COMPRESS_LEVELS,
  NUMBER_FORMATS,
  NUMBER_SIZES,
  PDF_IMAGE_DPIS,
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
  WATERMARK_COLORS,
  WATERMARK_ROTATIONS,
  WATERMARK_SIZES,
  type ToolOptions,
} from "@/lib/tool-options";
import { type ThumbnailState } from "@/lib/preview";
import { cn } from "@/lib/utils";

/** Same reasoning as the file cards: phones need a bigger hit area than 28px. */
const OPTION_BUTTON = "h-10 sm:h-7";

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
    options.kind === "rotate" ||
    options.kind === "invert" ||
    options.kind === "sign" ||
    options.kind === "fill-form" ||
    options.kind === "edit" ||
    options.kind === "crop" ||
    options.kind === "page-size" ||
    options.kind === "image-crop" ||
    options.kind === "redact"
  );
}

/** What a batch does with settings drawn on the first file's preview. Null when nothing differs. */
export function batchHint(options: ToolOptions, fileCount: number): string | null {
  if (fileCount < 2) return null;
  const others = fileCount - 1;
  const rest = `the other ${others} file${others === 1 ? "" : "s"}`;
  switch (options.kind) {
    case "crop":
      return options.applyAll
        ? `The preview shows the first file. The same crop applies to every page of ${rest}.`
        : `A different crop per page works on one PDF. Pick All pages to crop all ${fileCount}.`;
    case "redact":
      return `The preview shows the first file. Boxes you draw are blacked out at the same spot in ${rest}, and the kinds of data you accept are found again in each of them.`;
    case "extract-images":
      return `The grid shows the first file. The size filter applies to ${rest} too; every image that passes it is kept.`;
    case "ocr":
    case "pdf-image":
      return `All ${fileCount} files use these settings, one after another.`;
    default:
      return null;
  }
}

/** One sentence telling the reader what the panel next to it is asking for. */
export function optionsHint(options: ToolOptions, actionLabel: string): string {
  switch (options.kind) {
    case "convert-doc":
      return convertDocHint(options);
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
      return "Turn each page left, right or 180 degrees, or all at once. You can also mirror pages. Text stays text.";
    case "split":
      return options.mode === "bookmarks"
        ? "Cut at the PDF's own bookmarks. The files below are exactly what you will get."
        : options.mode === "text"
          ? "Start a new file at every page that contains your text. The files below update as you type."
          : options.mode === "smart"
            ? "Finds where each document starts in a combined PDF or scan, from page numbers, titles, letterheads, reference numbers and blank sheets. Scans are read with OCR in this tab; nothing is uploaded."
          : options.mode === "select"
            ? "Pick the pages to pull out. Each becomes its own PDF unless you merge them."
          : options.mode === "ranges"
            ? "Each range becomes its own PDF, or tick merge for one PDF with every range."
          : "Pick how to cut the PDF. The preview shows every file you will get.";
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
    case "translate":
      return options.mode === "own"
        ? "The PDF stays here. Its text goes from this tab straight to Google Gemini with your key; our server sees nothing."
        : "The PDF stays here. Its text goes through our server to Google Gemini to be translated. The new PDF is built in this tab.";
    case "summarize":
      return options.mode === "own"
        ? "The PDF stays here. Its page text goes from this tab straight to Google Gemini with your key; our server sees nothing. Every figure in the summary is checked against the PDF."
        : "The PDF stays here. Its page text goes through our server to Google Gemini. Every figure in the summary is checked against the PDF, and each point names its pages.";
    case "pdf-to-markdown":
      return options.output === "zip"
        ? "index.md plus an images folder, linked from the text. Headings, lists, tables and links come through; scans are read with OCR."
        : "One .md file to paste anywhere. Headings, lists, tables and links come through; pictures are left out. Scans are read with OCR.";
    case "pdf-to-html":
      return options.mode === "reflow"
        ? "A clean web page: real headings, paragraphs, lists, tables and pictures that reflow on any screen. Pages with no text are read with OCR."
        : options.mode === "exact"
          ? "Each page is a box of the same size with every block placed where it was. The text stays selectable, but it does not reflow."
          : "Each page is a picture with an invisible text layer on top, so it looks identical and you can still search and copy.";
    case "pdf-to-pptx":
      return options.mode === "editable"
        ? "Each page becomes a slide with real text boxes, tables, pictures and shapes where they were. Pages with no text are read with OCR."
        : "Each page becomes one picture on its slide. It looks the same, but nothing can be edited.";
    case "pdf-to-word":
      return options.mode === "editable"
        ? "Paragraphs, headings, lists, tables and pictures become real Word content. Pages with no text are read with OCR."
        : options.mode === "exact"
          ? "Every block sits in a Word text box at its place on the page. It looks the same and the text stays editable, but it does not reflow."
          : "Each page becomes one picture in the Word file. It looks the same, but the text cannot be edited.";
    case "resize":
      return "Set the longest edge in pixels. The aspect ratio stays as it is.";
    case "organize":
      return "Drag pages into order, turn, duplicate, delete or add blank pages, then save the new PDF.";
    case "compress":
      return "Every level keeps text selectable. Smallest may flatten scanned pages that have no text to shrink them further.";
    case "extract":
      return "Click the pages you want, or type them. They keep their order from the original PDF.";
    case "sign":
      return "Draw, type, or stamp a signature, then drag it onto the page.";
    case "fill-form":
      return options.fieldCount === null
        ? "Reading the form fields…"
        : options.fieldCount === 0
          ? "No fillable fields in this PDF."
          : "Type, tick and pick right on the page. Fields marked in red are required.";
    case "edit":
      return "Click a line to change it. Scans are read with OCR. Find and replace works across pages. Replaced letters are deleted from the file.";
    case "crop":
      return "Drag the box, or type margins. Keep one crop for every page or give each page its own.";
    case "redact":
      return "Scan for personal info or draw boxes over the text. Those pixels are burned out, not covered.";
    case "compare":
      return "Add two PDFs. First is the left file. The text diff is the result.";
    case "header-footer":
      return "Left, center, and right. {page} {pages} {date} expand on each page.";
    case "insert-blank":
      return "Insert one blank page after the page number you type. 0 puts it first.";
    case "flatten":
      return options.mode === "form"
        ? "Fields become part of the page. Text stays selectable. Choose what else to strip."
        : "Every page becomes a picture, so nothing underneath can be copied, edited or clicked.";
    case "invert":
      return "Pick a look. Text-keeping mode recolours without redrawing, so text stays selectable and the file stays small.";
    case "pdf-to-pdfa":
      return options.level === "1b"
        ? "PDF/A-1b is the strictest. Pages with see-through drawing or JPEG 2000 pictures become pictures with searchable text."
        : options.level === "3b"
          ? "Like 2b, and attachments stay inside the file. Pick it for e-invoices such as ZUGFeRD and Factur-X."
          : "The one most portals and archives ask for. Text stays selectable; fonts are embedded and scripts removed.";
    case "pdf-to-zip":
      return "Keep the PDFs whole or cut them into pages first. Name them with a pattern, pick a folder and compression.";
    case "alternate-mix":
      return "Files take turns, in card order. Reverse a file for back sides scanned last page first. Pages are copied as they are, so text stays selectable.";
    case "nup":
      return "Pick a grid, a paper size and how pages flow. Pages stay vector, so text stays selectable.";
    case "page-size":
      return "Pick a sheet or type your own size. Pages stay vector, so text stays selectable.";
    case "annotate":
      return options.variant === "numbers"
        ? options.bates
          ? "Bates numbers run on through every file, in list order, as real selectable text."
          : "Pick where the numbers sit, how they read, and where counting starts."
        : "Type the stamp, then set how it looks. The preview shows page 1. It is drawn in this tab as real text.";
    case "ocr":
      return "Tesseract reads each page in this tab. Hindi keeps its letters. Pages that already have words can be copied as-is. Slow on long scans.";
    case "ask":
      return "The PDFs stay here. Their extracted text and your chat go to Google Gemini.";
    case "scan":
      return "Use the camera or drop photos. Drag the corners to the page edges, pick a filter, then make the PDF. Nothing leaves this tab.";
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

    case "convert-doc":
      return <ConvertOptions options={options} onOptions={onOptions} disabled={disabled} files={files} />;

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
        <RotatePanel
          options={options}
          onOptions={onOptions}
          file={files?.[0]?.file}
          disabled={disabled}
        />
      );

    case "split":
      return (
        <SplitOptionsPanel
          options={options}
          onOptions={onOptions}
          file={files?.[0]?.file}
          fileKey={files?.[0]?.id ?? ""}
          baseName={(files?.[0]?.name ?? "document").replace(/\.[^.]+$/, "")}
          pageCount={pageCount}
          disabled={disabled}
        />
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

    case "translate":
      return (
        <div className="space-y-4">
          <Field label="Translate into" htmlFor="tr-target">
            <select
              id="tr-target"
              className="border-input bg-background h-10 w-full rounded-xl border px-3 text-sm"
              value={options.target}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, target: e.target.value })}
            >
              {TARGET_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Who translates</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["server", "Our server (free, no key)"],
                  ["own", "My own Gemini key"],
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
            {options.mode === "own" ? (
              <Input
                type="password"
                aria-label="Gemini API key"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your Gemini API key"
                value={options.key}
                disabled={disabled}
                onChange={(e) => onOptions({ ...options, key: e.target.value })}
              />
            ) : null}
          </div>
          <Field label="Pages" htmlFor="tr-range">
            <Input
              id="tr-range"
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

    case "summarize":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Length</p>
            <div className="flex flex-wrap gap-2">
              {SUMMARY_LENGTHS.map(({ id, name }) => (
                <Button
                  key={id}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.length === id ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, length: id })}
                >
                  {name}
                </Button>
              ))}
            </div>
          </div>
          <Field label="Write the summary in" htmlFor="sum-language">
            <select
              id="sum-language"
              className="border-input bg-background h-10 w-full rounded-xl border px-3 text-sm"
              value={options.language}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, language: e.target.value })}
            >
              <option value="auto">Same language as the PDF</option>
              {TARGET_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Who summarizes</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["server", "Our server (free, no key)"],
                  ["own", "My own Gemini key"],
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
            {options.mode === "own" ? (
              <Input
                type="password"
                aria-label="Gemini API key"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste your Gemini API key"
                value={options.key}
                disabled={disabled}
                onChange={(e) => onOptions({ ...options, key: e.target.value })}
              />
            ) : null}
          </div>
          <Field label="Pages" htmlFor="sum-range">
            <Input
              id="sum-range"
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

    case "pdf-to-markdown":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Save as</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["md", "One .md file"],
                  ["zip", "Zip with pictures"],
                ] as const
              ).map(([output, title]) => (
                <Button
                  key={output}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.output === output ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, output })}
                >
                  {title}
                </Button>
              ))}
            </div>
          </div>
          <Field label="Pages" htmlFor="md-range">
            <Input
              id="md-range"
              value={options.range}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, range: e.target.value })}
              placeholder="All pages, or e.g. 1-3, 7"
              inputMode="text"
              autoComplete="off"
            />
          </Field>
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

    case "pdf-to-html":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Layout</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["reflow", "Flowing page — headings, lists, tables"],
                  ["exact", "Exact layout — same as the page"],
                  ["picture", "Page pictures + invisible text"],
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
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Save as</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["html", "One .html file"],
                  ["zip", "Zip: index.html + images folder"],
                ] as const
              ).map(([output, title]) => (
                <Button
                  key={output}
                  type="button"
                  size="sm"
                  className={OPTION_BUTTON}
                  variant={options.output === output ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => onOptions({ ...options, output })}
                >
                  {title}
                </Button>
              ))}
            </div>
          </div>
          <Field label="Pages" htmlFor="html-range">
            <Input
              id="html-range"
              value={options.range}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, range: e.target.value })}
              placeholder="All pages, or e.g. 1-3, 7"
              inputMode="text"
              autoComplete="off"
            />
          </Field>
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

    case "pdf-to-pptx":
      return (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Slides</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["editable", "Editable — text boxes, tables, shapes"],
                  ["picture", "Page pictures (not editable)"],
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
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink">Slide size</p>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ["match", "Same as the page"],
                  ["16:9", "Widescreen 16:9"],
                  ["4:3", "Standard 4:3"],
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
          </div>
          <Field label="Pages" htmlFor="pptx-range">
            <Input
              id="pptx-range"
              value={options.range}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, range: e.target.value })}
              placeholder="All pages, or e.g. 1-3, 7"
              inputMode="text"
              autoComplete="off"
            />
          </Field>
          {options.mode === "editable" ? (
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
          <Field label="Pages to extract" htmlFor="extract-range">
            <Input
              id="extract-range"
              value={options.range}
              disabled={disabled || options.pageCount === 0}
              onChange={(e) => onOptions({ ...options, range: e.target.value })}
              placeholder={
                options.pageCount > 0 ? "e.g. 1-3, 7" : "Reading pages…"
              }
              inputMode="text"
              autoComplete="off"
            />
          </Field>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {options.pageCount === 0
              ? "Reading the pages in this PDF…"
              : kept.length === 0
                ? options.range.trim()
                  ? `No pages between 1 and ${options.pageCount} there.`
                  : `Click pages on the left, or type them. This PDF has ${options.pageCount} pages.`
                : `Extracting ${kept.length} of ${options.pageCount} pages.`}
          </p>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4"
              checked={options.separate ?? false}
              disabled={disabled}
              onChange={(e) => onOptions({ ...options, separate: e.target.checked })}
            />
            <span>Save each page as its own PDF</span>
          </label>
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

    case "organize":
      return (
        <OrganizePanel
          options={options}
          onOptions={onOptions}
          file={files?.[0]?.file}
          pageCount={pageCount}
          disabled={disabled}
        />
      );

    case "sign":
      return null;

    case "fill-form":
      return <FillFormPanel options={options} onOptions={onOptions} disabled={disabled} />;

    case "edit":
      return null;

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

    case "flatten":
      return (
        <FlattenPanel options={options} onOptions={onOptions} disabled={disabled} />
      );

    case "invert":
      return (
        <InvertPanel
          options={options}
          onOptions={onOptions}
          file={files?.[0]?.file}
          disabled={disabled}
        />
      );

    case "nup":
      return (
        <NupPanel options={options} onOptions={onOptions} disabled={disabled} />
      );

    case "pdf-to-pdfa":
      return (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Conformance</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["2b", "PDF/A-2b — recommended"],
                ["1b", "PDF/A-1b — strictest"],
                ["3b", "PDF/A-3b — keeps attachments"],
              ] as const
            ).map(([level, title]) => (
              <Button
                key={level}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.level === level ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ ...options, level })}
              >
                {title}
              </Button>
            ))}
          </div>
        </div>
      );

    case "pdf-to-zip":
      return (
        <ZipPanel
          options={options}
          onOptions={onOptions}
          files={files ?? []}
          filePages={filePages ?? []}
          disabled={disabled}
        />
      );

    case "alternate-mix":
      return (
        <MixPanel
          options={options}
          onOptions={onOptions}
          files={files ?? []}
          filePages={filePages ?? []}
          disabled={disabled}
        />
      );

    case "page-size":
      return (
        <PageSizePanel
          options={options}
          onOptions={onOptions}
          file={files?.[0]?.file}
          disabled={disabled}
        />
      );

    case "crop":
      return (
        <CropPanel
          options={options}
          onOptions={onOptions}
          file={files?.[0]?.file}
          disabled={disabled}
        />
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
        <div className="space-y-5">
          {files && files.length > 0 ? (
            <ScanSettings options={options} onOptions={onOptions} disabled={disabled} />
          ) : null}
          <ScanCapture
            disabled={disabled}
            onCapture={(file) => onAddFiles?.([file])}
          />
        </div>
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

function FillFormPanel({
  options,
  onOptions,
  disabled,
}: {
  options: Extract<ToolOptions, { kind: "fill-form" }>;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
}) {
  if (!options.fieldCount) return null;
  const filled = Object.keys(options.values).length;
  const choices = [
    {
      id: "editable" as const,
      label: "Keep editable",
      note: "Fields stay fields. Anyone can still change them in Acrobat, Chrome or Preview.",
    },
    {
      id: "flatten" as const,
      label: "Flatten",
      note: "Values become part of the page. Nothing can be changed; text stays selectable.",
    },
  ];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground" data-testid="fill-form-status">
        {options.fieldCount} field{options.fieldCount === 1 ? "" : "s"} found
        {filled > 0 ? `, ${filled} changed` : ""}.
      </p>
      {options.missing.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <p className="font-medium">Still required:</p>
          <ul className="mt-1 list-disc pl-5">
            {options.missing.slice(0, 6).map((label) => (
              <li key={label}>{label}</li>
            ))}
            {options.missing.length > 6 && <li>and {options.missing.length - 6} more</li>}
          </ul>
        </div>
      )}
      <fieldset className="space-y-2" disabled={disabled}>
        <legend className="mb-1 text-sm font-medium text-ink">Save as</legend>
        {choices.map((choice) => (
          <label key={choice.id} className="flex items-start gap-2 text-sm text-ink">
            <input
              type="radio"
              name="fill-form-output"
              className="mt-0.5 size-4"
              checked={options.output === choice.id}
              onChange={() => onOptions({ ...options, output: choice.id })}
            />
            <span>
              <span className="font-medium">{choice.label}</span>
              <span className="block text-muted-foreground">{choice.note}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {filled > 0 && (
        <Button
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onOptions({ ...options, values: {} })}
        >
          Undo all changes
        </Button>
      )}
    </div>
  );
}
