"use client";

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";

import { PageGrid, type GridPage } from "@/components/page-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PT_PER_MM,
  boxToMargins,
  marginsToBox,
} from "@/lib/page-tools/geometry";
import type { RatioRect } from "@/lib/page-tools/types";
import type { ToolOptions } from "@/lib/tool-options";
import { usePdfSession, type PdfSession } from "@/lib/use-pdf-session";
import { cn } from "@/lib/utils";

type CropOptions = Extract<ToolOptions, { kind: "crop" }>;

type Handle = "move" | "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

const MIN = 0.03;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function CropEditor({
  session,
  page,
  rect,
  onRect,
  disabled,
  aspect,
}: {
  session: PdfSession | null;
  page: number;
  rect: RatioRect;
  onRect: (r: RatioRect) => void;
  disabled: boolean;
  aspect: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<{ session: PdfSession; page: number; url: string } | null>(null);
  useEffect(() => {
    if (!session) return;
    let live = true;
    void session.image(page, 900).then((url) => live && setLoaded({ session, page, url }), () => undefined);
    return () => {
      live = false;
    };
  }, [session, page]);
  const url = loaded && loaded.session === session && loaded.page === page ? loaded.url : null;

  const begin = (event: React.PointerEvent, handle: Handle) => {
    if (disabled || !host.current) return;
    event.preventDefault();
    event.stopPropagation();
    const el = host.current;
    const start = { x: event.clientX, y: event.clientY, rect };
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - start.x) / r.width;
      const dy = (e.clientY - start.y) / r.height;
      let { x, y, w, h } = start.rect;
      const right = x + w;
      const bottom = y + h;
      if (handle === "move") {
        x = clamp(x + dx, 0, 1 - w);
        y = clamp(y + dy, 0, 1 - h);
      } else {
        if (handle.includes("w")) x = clamp(x + dx, 0, right - MIN);
        if (handle.includes("n")) y = clamp(y + dy, 0, bottom - MIN);
        if (handle.includes("e")) w = clamp(right + dx, x + MIN, 1) - x;
        else if (handle.includes("w")) w = right - x;
        if (handle.includes("s")) h = clamp(bottom + dy, y + MIN, 1) - y;
        else if (handle.includes("n")) h = bottom - y;
      }
      onRect({ x, y, w, h });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const nudge = (event: React.KeyboardEvent) => {
    if (disabled) return;
    const step = event.shiftKey ? 0.05 : 0.01;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = d[event.key];
    if (!delta) return;
    event.preventDefault();
    if (event.altKey) {
      onRect({
        ...rect,
        w: clamp(rect.w + delta[0], MIN, 1 - rect.x),
        h: clamp(rect.h + delta[1], MIN, 1 - rect.y),
      });
    } else {
      onRect({
        ...rect,
        x: clamp(rect.x + delta[0], 0, 1 - rect.w),
        y: clamp(rect.y + delta[1], 0, 1 - rect.h),
      });
    }
  };

  const dots: [Handle, string, string][] = [
    ["nw", "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize", "Top left corner"],
    ["ne", "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize", "Top right corner"],
    ["sw", "left-0 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize", "Bottom left corner"],
    ["se", "right-0 bottom-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize", "Bottom right corner"],
    ["n", "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize", "Top edge"],
    ["s", "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2 cursor-ns-resize", "Bottom edge"],
    ["w", "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize", "Left edge"],
    ["e", "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize", "Right edge"],
  ];

  return (
    <div
      ref={host}
      className="relative mx-auto w-full max-w-[34rem] select-none overflow-hidden rounded-xl border border-ink/10 bg-muted/40"
      style={{ aspectRatio: String(aspect) }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" draggable={false} className="absolute inset-0 size-full" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
          Reading the page…
        </div>
      )}
      <div
        role="group"
        aria-label="Crop box. Arrow keys move it, Alt plus arrows resize it."
        tabIndex={disabled ? -1 : 0}
        onKeyDown={nudge}
        onPointerDown={(e) => begin(e, "move")}
        className={cn(
          "absolute touch-none rounded-sm border-2 border-signal outline-none focus-visible:ring-2 focus-visible:ring-signal",
          disabled ? "cursor-default" : "cursor-move",
        )}
        style={{
          left: `${rect.x * 100}%`,
          top: `${rect.y * 100}%`,
          width: `${rect.w * 100}%`,
          height: `${rect.h * 100}%`,
          boxShadow: "0 0 0 9999px rgba(20,22,28,0.45)",
        }}
      >
        {dots.map(([handle, pos, label]) => (
          <span
            key={handle}
            role="presentation"
            aria-label={label}
            className={cn(
              "absolute size-4 touch-none rounded-full border-2 border-signal bg-card sm:size-3",
              pos,
            )}
            onPointerDown={(e) => begin(e, handle)}
          />
        ))}
      </div>
    </div>
  );
}

export function CropPanel({
  options,
  onOptions,
  file,
  disabled,
}: {
  options: CropOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  disabled: boolean;
}) {
  const { session, pages: sizes } = usePdfSession(file);
  const [current, setCurrent] = useState(0);
  const [unit, setUnit] = useState<"mm" | "%">("mm");
  const count = sizes?.length ?? 0;
  const page = Math.min(current, Math.max(0, count - 1));
  const size = sizes?.[page] ?? { width: 595, height: 842 };
  const rect: RatioRect = options.applyAll
    ? options.box
    : (options.perPage[page] ?? { x: 0, y: 0, w: 1, h: 1 });

  const setRect = (next: RatioRect) => {
    if (options.applyAll) {
      onOptions({ ...options, box: { ...options.box, ...next } });
    } else {
      onOptions({ ...options, perPage: { ...options.perPage, [page]: next } });
    }
  };

  const margins = boxToMargins(rect, size.width, size.height);
  const shown = (pt: number, span: number) =>
    unit === "%" ? (pt / span) * 100 : pt / PT_PER_MM;
  const parse = (v: number, span: number) =>
    unit === "%" ? (v / 100) * span : v * PT_PER_MM;
  const field = (
    side: "top" | "right" | "bottom" | "left",
    label: string,
  ) => {
    const span = side === "top" || side === "bottom" ? size.height : size.width;
    return (
      <div className="space-y-1" key={side}>
        <label className="text-xs font-medium text-ink" htmlFor={`crop-${side}`}>
          {label}
        </label>
        <Input
          id={`crop-${side}`}
          type="number"
          inputMode="decimal"
          min={0}
          step={unit === "%" ? 0.5 : 1}
          disabled={disabled}
          value={Number(shown(margins[side], span).toFixed(1))}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isFinite(n) || n < 0) return;
            setRect(
              marginsToBox(
                { ...margins, [side]: parse(n, span) },
                size.width,
                size.height,
              ),
            );
          }}
        />
      </div>
    );
  };

  const gridPages: GridPage[] = Array.from({ length: count }, (_, i) => ({
    key: String(i),
    page: i,
    turn: 0,
  }));
  const edited = options.applyAll
    ? false
    : (n: number) => options.perPage[n] !== undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            [true, "Same crop on every page"],
            [false, "Each page its own crop"],
          ] as const
        ).map(([all, title]) => (
          <Button
            key={title}
            type="button"
            size="sm"
            className="h-10 sm:h-7"
            variant={options.applyAll === all ? "default" : "outline"}
            aria-pressed={options.applyAll === all}
            disabled={disabled}
            onClick={() =>
              all === options.applyAll
                ? undefined
                : onOptions({ ...options, applyAll: all, box: all ? { ...options.box, ...rect } : options.box })
            }
          >
            {title}
          </Button>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 sm:h-7"
          disabled={disabled}
          onClick={() =>
            setRect({ x: 0, y: 0, w: 1, h: 1 })
          }
        >
          <RotateCcw /> Reset
        </Button>
        {!options.applyAll ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-10 sm:h-7"
            disabled={disabled}
            onClick={() =>
              onOptions({ ...options, applyAll: true, box: { ...options.box, ...rect } })
            }
          >
            Use this crop on all pages
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_12rem]">
        <CropEditor
          session={session}
          page={page}
          rect={rect}
          onRect={setRect}
          disabled={disabled || !sizes}
          aspect={size.width / size.height}
        />
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Margins</p>
            <div className="flex gap-1">
              {(["mm", "%"] as const).map((u) => (
                <Button
                  key={u}
                  type="button"
                  size="sm"
                  className="h-8 px-2 sm:h-6"
                  variant={unit === u ? "default" : "outline"}
                  aria-pressed={unit === u}
                  onClick={() => setUnit(u)}
                >
                  {u}
                </Button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {field("top", "Top")}
            {field("bottom", "Bottom")}
            {field("left", "Left")}
            {field("right", "Right")}
          </div>
          <p className="text-xs text-muted-foreground">
            {options.applyAll
              ? `Applies to all ${count || ""} pages.`.replace("  ", " ")
              : `Editing page ${page + 1}. Pages you have not touched use the shared box.`}
          </p>
        </div>
      </div>

      {count > 1 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Pages</p>
          <div className="max-h-72 overflow-y-auto rounded-xl border border-ink/10 bg-secondary p-3">
            <PageGrid
              session={session}
              sizes={sizes}
              pages={gridPages.map((p) => ({
                ...p,
                label: edited && edited(p.page) ? `${p.page + 1} · cropped` : String(p.page + 1),
              }))}
              selected={new Set([String(page)])}
              onSelected={(next) => {
                const k = [...next][0];
                if (k !== undefined) setCurrent(Number(k));
              }}
              selectMode="single"
              quietSelection
              ariaLabel="Pages. Pick one to crop."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
