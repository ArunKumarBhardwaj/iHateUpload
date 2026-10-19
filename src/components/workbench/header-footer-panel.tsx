"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { expandStamp, placeStamps } from "@/lib/header-footer";
import type { ThumbnailState } from "@/lib/preview";
import { WATERMARK_COLORS, type ToolOptions } from "@/lib/tool-options";

type Options = Extract<ToolOptions, { kind: "header-footer" }>;

const OPTION_BUTTON = "h-10 sm:h-7";
const SHORT_EDGE = 595;
const FAMILY = "Helvetica, Arial, sans-serif";

function widthOf(text: string, size: number, bold: boolean): number {
  const ctx =
    typeof document === "undefined"
      ? null
      : document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size * 0.55;
  ctx.font = `${bold ? 700 : 400} 100px ${FAMILY}`;
  return (ctx.measureText(text).width / 100) * size;
}

function Preview({
  options,
  thumbnail,
  filename,
  pageCount,
}: {
  options: Options;
  thumbnail?: ThumbnailState;
  filename: string;
  pageCount: number;
}) {
  const [aspect, setAspect] = useState(1 / Math.SQRT2);
  const page =
    aspect <= 1
      ? { w: SHORT_EDGE, h: SHORT_EDGE / aspect }
      : { w: SHORT_EDGE * aspect, h: SHORT_EDGE };
  const pages = Math.max(pageCount, 1);
  // The first page that will really carry a stamp, so {page} reads true.
  const shownPage = options.skipFirst && pages > 1 ? 2 : 1;
  const stamps = useMemo(() => {
    const ctx = {
      pages,
      date: new Date().toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
      time: new Date().toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      }),
      filename,
    };
    return placeStamps(
      {
        left: expandStamp(options.left, shownPage, ctx),
        center: expandStamp(options.center, shownPage, ctx),
        right: expandStamp(options.right, shownPage, ctx),
        band: options.band,
        fontSize: options.fontSize,
        margin: options.margin,
      },
      page.w,
      page.h,
      (text) => widthOf(text, options.fontSize, options.bold),
    );
  }, [options, page.w, page.h, pages, shownPage, filename]);

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
          aria-label="Header and footer preview"
        >
          {stamps.map((stamp, index) => (
            <text
              key={index}
              x={stamp.x}
              y={page.h - stamp.y}
              fontSize={options.fontSize}
              fontWeight={options.bold ? 700 : 400}
              fontFamily={FAMILY}
              fill={options.color}
            >
              {stamp.text}
            </text>
          ))}
        </svg>
      </div>
      <p className="text-xs text-ink/70">
        {thumbnail?.status === "ready"
          ? `Shows how page ${shownPage} will look.`
          : "Add a PDF to see a page here."}
      </p>
    </div>
  );
}

export function HeaderFooterPanel({
  options,
  onOptions,
  disabled,
  firstPage,
  filename,
  pageCount,
}: {
  options: Options;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
  firstPage?: ThumbnailState;
  filename: string;
  pageCount: number;
}) {
  const set = (patch: Partial<Options>) => onOptions({ ...options, ...patch });
  const num = (value: string, min: number, max: number, key: "fontSize" | "margin") => {
    const n = Number(value);
    if (Number.isFinite(n)) set({ [key]: Math.min(max, Math.max(min, n)) });
  };
  return (
    <div className="space-y-4">
      <Preview
        options={options}
        thumbnail={firstPage}
        filename={filename}
        pageCount={pageCount}
      />
      {(
        [
          ["left", "Left", "hf-left", "{filename}"],
          ["center", "Center", "hf-center", "{page} / {pages}"],
          ["right", "Right", "hf-right", "{date}"],
        ] as const
      ).map(([key, label, id, placeholder]) => (
        <div key={key} className="space-y-2">
          <label className="text-sm font-medium text-ink" htmlFor={id}>
            {label}
          </label>
          <Input
            id={id}
            value={options[key]}
            disabled={disabled}
            onChange={(e) => set({ [key]: e.target.value })}
            placeholder={placeholder}
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {"{page} {pages} {date} {time} {filename}"} fill in on each page.
      </p>
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Place on</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["header", "Header"],
              ["footer", "Footer"],
              ["both", "Both"],
            ] as const
          ).map(([band, title]) => (
            <Button
              key={band}
              type="button"
              size="sm"
              className={OPTION_BUTTON}
              variant={options.band === band ? "default" : "outline"}
              disabled={disabled}
              onClick={() => set({ band })}
            >
              {title}
            </Button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink" htmlFor="hf-size">
            Font size
          </label>
          <Input
            id="hf-size"
            type="number"
            min={6}
            max={48}
            value={options.fontSize}
            disabled={disabled}
            onChange={(e) => num(e.target.value, 6, 48, "fontSize")}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink" htmlFor="hf-margin">
            Margin (pt)
          </label>
          <Input
            id="hf-margin"
            type="number"
            min={8}
            max={144}
            value={options.margin}
            disabled={disabled}
            onChange={(e) => num(e.target.value, 8, 144, "margin")}
          />
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Colour</p>
        <div className="flex flex-wrap items-center gap-2">
          {["#333338", ...WATERMARK_COLORS.slice(0, 4)].map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Colour ${color}`}
              aria-pressed={options.color.toLowerCase() === color.toLowerCase()}
              disabled={disabled}
              onClick={() => set({ color })}
              className="size-7 rounded-full ring-1 ring-ink/20 aria-pressed:ring-2 aria-pressed:ring-signal"
              style={{ backgroundColor: color }}
            />
          ))}
          <input
            type="color"
            aria-label="Custom colour"
            value={/^#[0-9a-f]{6}$/i.test(options.color) ? options.color : "#333338"}
            disabled={disabled}
            onChange={(e) => set({ color: e.target.value })}
            className="size-7 cursor-pointer rounded border border-ink/20 bg-transparent p-0"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="size-4"
          checked={options.bold}
          disabled={disabled}
          onChange={(e) => set({ bold: e.target.checked })}
        />
        Bold
      </label>
      <div className="space-y-2">
        <label className="text-sm font-medium text-ink" htmlFor="hf-range">
          Pages
        </label>
        <Input
          id="hf-range"
          value={options.range}
          disabled={disabled}
          onChange={(e) => set({ range: e.target.value })}
          placeholder="All pages, or 1-3, 7"
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="size-4"
          checked={options.skipFirst}
          disabled={disabled}
          onChange={(e) => set({ skipFirst: e.target.checked })}
        />
        Skip first page
      </label>
    </div>
  );
}
