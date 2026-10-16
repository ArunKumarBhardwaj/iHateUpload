"use client";

import { useMemo, useState } from "react";

import type { ThumbnailState } from "@/lib/preview";
import type { ToolOptions } from "@/lib/tool-options";
import { watermarkStamps } from "@/lib/watermark";

/** Width of the stamp at `size` pt, measured with the browser's bold sans. */
function textWidthAt(text: string, size: number): number {
  const canvas =
    typeof document === "undefined" ? null : document.createElement("canvas");
  const ctx = canvas?.getContext("2d");
  if (!ctx) return text.length * size * 0.62;
  ctx.font = `700 100px Helvetica, Arial, sans-serif`;
  return (ctx.measureText(text).width / 100) * size;
}

/** The thumbnail does not carry the page size, so assume the short edge is A4. */
const SHORT_EDGE = 595;

export function WatermarkPreview({
  thumbnail,
  options,
}: {
  thumbnail?: ThumbnailState;
  options: Extract<ToolOptions, { kind: "annotate" }>;
}) {
  const [aspect, setAspect] = useState(1 / Math.SQRT2);
  const text = options.text.trim();

  const page = useMemo(
    () =>
      aspect <= 1
        ? { w: SHORT_EDGE, h: SHORT_EDGE / aspect }
        : { w: SHORT_EDGE * aspect, h: SHORT_EDGE },
    [aspect],
  );

  const stamps = useMemo(
    () =>
      text
        ? watermarkStamps(options, page.w, page.h, (size) =>
            textWidthAt(text, size),
          )
        : [],
    [options, page, text],
  );

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
          aria-label="Watermark preview"
          role="img"
        >
          {stamps.map((stamp, index) => (
            <text
              key={index}
              transform={`translate(${stamp.x} ${page.h - stamp.y}) rotate(${-stamp.rotation})`}
              fontSize={stamp.size}
              fontWeight={700}
              fontFamily="Helvetica, Arial, sans-serif"
              fill={options.color}
              fillOpacity={options.opacity}
            >
              {text}
            </text>
          ))}
        </svg>
      </div>
      {thumbnail?.status !== "ready" ? (
        <p className="text-xs text-ink/70">Add a PDF to see page 1 here.</p>
      ) : null}
    </div>
  );
}
