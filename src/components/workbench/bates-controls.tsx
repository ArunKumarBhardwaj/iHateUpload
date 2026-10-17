"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  BATES_DIGITS_MAX,
  BATES_POSITIONS,
  BATES_SIZE_MAX,
  BATES_SIZE_MIN,
  batesLabel,
  batesPlacement,
  batesPreview,
} from "@/lib/bates";
import type { ThumbnailState } from "@/lib/preview";
import { WATERMARK_COLORS, type ToolOptions } from "@/lib/tool-options";

type AnnotateOptions = Extract<ToolOptions, { kind: "annotate" }>;

const OPTION_BUTTON = "h-10 sm:h-7";
const SHORT_EDGE = 595;

function NumberField({
  id,
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-ink" htmlFor={id}>
        {label}
      </label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(Math.round(next));
        }}
      />
    </div>
  );
}

function BatesSample({
  thumbnail,
  options,
}: {
  thumbnail?: ThumbnailState;
  options: AnnotateOptions;
}) {
  const [aspect, setAspect] = useState(1 / Math.SQRT2);
  const page =
    aspect <= 1
      ? { w: SHORT_EDGE, h: SHORT_EDGE / aspect }
      : { w: SHORT_EDGE * aspect, h: SHORT_EDGE };
  const label = batesLabel(options, options.startAt);
  // Helvetica averages about 0.55 em per character; close enough for a sample.
  const textWidth = label.length * options.batesSize * 0.55;
  const point = batesPlacement(
    options.position,
    page.w,
    page.h,
    textWidth,
    options.batesSize,
    options.margin,
  );
  const pad = options.batesSize * 0.3;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">Preview</p>
      <div
        className="relative mx-auto w-full max-w-[240px] overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-ink/10"
        style={{ aspectRatio: `${page.w} / ${page.h}` }}
      >
        {thumbnail?.status === "ready" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail.url}
            alt="Page 1"
            className="absolute inset-0 size-full object-fill"
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                setAspect(naturalWidth / naturalHeight);
              }
            }}
          />
        ) : null}
        <svg
          className="absolute inset-0 size-full"
          viewBox={`0 0 ${page.w} ${page.h}`}
          preserveAspectRatio="none"
          role="img"
          aria-label="Bates number preview"
        >
          {options.batesPlate ? (
            <rect
              x={point.x - pad}
              y={page.h - point.y - options.batesSize * 0.95 - pad / 2}
              width={textWidth + pad * 2}
              height={options.batesSize * 1.2 + pad}
              fill="#fff"
            />
          ) : null}
          <text
            x={point.x}
            y={page.h - point.y}
            fontSize={options.batesSize}
            fontFamily="Helvetica, Arial, sans-serif"
            fill={options.color}
          >
            {label}
          </text>
        </svg>
      </div>
    </div>
  );
}

/** The Bates half of the Page Numbers panel and the whole of the Bates tool. */
export function BatesControls({
  options,
  onOptions,
  disabled,
  filePages,
  firstPage,
}: {
  options: AnnotateOptions;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
  filePages: number[];
  firstPage?: ThumbnailState;
}) {
  const set = (patch: Partial<AnnotateOptions>) =>
    onOptions({ ...options, ...patch });
  const known = filePages.length > 0 && filePages.every((count) => count > 0);
  const summary = known ? batesPreview(options, filePages) : null;

  return (
    <div className="space-y-4">
      {summary ? (
        <div
          className="rounded-lg border border-ink/10 bg-ink/[0.03] p-3 text-sm"
          data-testid="bates-range"
        >
          {summary.pages > 0 ? (
            <>
              <p className="font-mono font-medium text-ink">
                {summary.first} → {summary.last}
              </p>
              <p className="text-xs text-ink/70">
                {summary.pages} stamped {summary.pages === 1 ? "page" : "pages"}{" "}
                across {filePages.length} {filePages.length === 1 ? "file" : "files"}
                . The count carries on from one file to the next.
              </p>
            </>
          ) : (
            <p className="text-ink/70">No pages match the range below.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink/70">
          The count carries on from one file to the next, in the order of the list.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink" htmlFor="bates-prefix">
            Prefix
          </label>
          <Input
            id="bates-prefix"
            value={options.batesPrefix}
            disabled={disabled}
            onChange={(e) => set({ batesPrefix: e.target.value })}
            placeholder="ABC"
            autoComplete="off"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink" htmlFor="bates-suffix">
            Suffix
          </label>
          <Input
            id="bates-suffix"
            value={options.batesSuffix}
            disabled={disabled}
            onChange={(e) => set({ batesSuffix: e.target.value })}
            placeholder="(optional)"
            autoComplete="off"
          />
        </div>
        <NumberField
          id="bates-start"
          label="Start at"
          value={options.startAt}
          min={0}
          max={999999999}
          disabled={disabled}
          onChange={(startAt) => set({ startAt: Math.max(0, startAt) })}
        />
        <NumberField
          id="bates-digits"
          label="Digits"
          value={options.batesDigits}
          min={1}
          max={BATES_DIGITS_MAX}
          disabled={disabled}
          onChange={(batesDigits) => set({ batesDigits })}
        />
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Position</p>
        <div className="flex flex-wrap gap-2">
          {BATES_POSITIONS.map((position) => (
            <Button
              key={position.id}
              type="button"
              size="sm"
              className={OPTION_BUTTON}
              variant={options.position === position.id ? "default" : "outline"}
              disabled={disabled}
              onClick={() => set({ position: position.id })}
            >
              {position.title}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField
          id="bates-size"
          label="Font size (pt)"
          value={options.batesSize}
          min={BATES_SIZE_MIN}
          max={BATES_SIZE_MAX}
          disabled={disabled}
          onChange={(batesSize) => set({ batesSize })}
        />
        <NumberField
          id="bates-margin"
          label="Margin (pt)"
          value={options.margin}
          min={0}
          max={200}
          disabled={disabled}
          onChange={(margin) => set({ margin: Math.max(0, margin) })}
        />
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
              onClick={() => set({ color })}
              className="size-8 rounded-full border border-ink/20 aria-pressed:ring-2 aria-pressed:ring-signal aria-pressed:ring-offset-2 sm:size-6"
              style={{ backgroundColor: color }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom colour"
            value={options.color}
            disabled={disabled}
            onChange={(event) => set({ color: event.target.value })}
            className="h-8 w-10 cursor-pointer rounded border border-ink/20 bg-transparent sm:h-6 sm:w-8"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={options.batesPlate}
            disabled={disabled}
            onChange={(event) => set({ batesPlate: event.target.checked })}
          />
          <span>White plate behind the number, for dark scans and artwork.</span>
        </label>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={options.skipFirst}
            disabled={disabled}
            onChange={(event) => set({ skipFirst: event.target.checked })}
          />
          <span>Skip the first page of each file. It does not use up a number.</span>
        </label>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-ink" htmlFor="bates-range">
          Pages in each file
        </label>
        <Input
          id="bates-range"
          value={options.range}
          disabled={disabled}
          onChange={(e) => set({ range: e.target.value })}
          placeholder="All pages, or e.g. 2-, 1-3, 7"
          inputMode="text"
          autoComplete="off"
        />
      </div>

      <BatesSample thumbnail={firstPage} options={options} />
    </div>
  );
}
