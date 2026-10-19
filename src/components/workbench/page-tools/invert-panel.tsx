"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { mapPixel } from "@/lib/page-tools/colour";
import type { InvertEngine, InvertMode } from "@/lib/page-tools/types";
import type { ToolOptions } from "@/lib/tool-options";
import { usePdfSession, type PdfSession } from "@/lib/use-pdf-session";

type InvertOptions = Extract<ToolOptions, { kind: "invert" }>;

const BTN = "h-10 sm:h-7";

const MODES: [InvertMode, string, string][] = [
  ["dark", "Dark mode", "Light text on a soft dark page. Pictures keep their hues."],
  ["invert", "Full invert", "Every colour flipped, like a photo negative."],
  ["sepia", "Sepia", "Warm paper tones, easy on the eyes."],
  ["grayscale", "Grayscale", "Drops colour, keeps the layout."],
];

const ENGINES: [InvertEngine, string, string][] = [
  ["vector", "Keep text selectable", "Recolours without redrawing, so the file stays small and text stays text."],
  ["raster", "Flatten to pictures", "Renders every page as an image. Pick this if a viewer shows the vector mode wrongly."],
];

function Preview({
  session,
  mode,
}: {
  session: PdfSession | null;
  mode: InvertMode | null;
}) {
  const [shown, setShown] = useState<{ session: PdfSession; mode: InvertMode | null; url: string } | null>(null);
  useEffect(() => {
    if (!session) return;
    let live = true;
    const filter = mode
      ? (ctx: CanvasRenderingContext2D, w: number, h: number) => {
          const px = ctx.getImageData(0, 0, w, h);
          const d = px.data;
          for (let i = 0; i < d.length; i += 4) {
            const [r, g, b] = mapPixel(mode, d[i], d[i + 1], d[i + 2]);
            d[i] = r;
            d[i + 1] = g;
            d[i + 2] = b;
          }
          ctx.putImageData(px, 0, 0);
        }
      : undefined;
    void session.image(0, 360, filter, mode ?? "none").then(
      (url) => live && setShown({ session, mode, url }),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [session, mode]);
  const url = shown && shown.session === session && shown.mode === mode ? shown.url : null;
  return (
    <div className="flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md bg-muted/40 ring-1 ring-ink/10">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={mode ? `Page 1 after, ${mode}` : "Page 1 before"} className="size-full object-contain" />
      ) : (
        <span className="text-xs text-muted-foreground">Reading page 1…</span>
      )}
    </div>
  );
}

export function InvertPanel({
  options,
  onOptions,
  file,
  disabled,
}: {
  options: InvertOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  disabled: boolean;
}) {
  const { session } = usePdfSession(file);
  const set = (patch: Partial<InvertOptions>) => onOptions({ ...options, ...patch });
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Look</p>
        <div className="flex flex-wrap gap-2">
          {MODES.map(([id, title]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              className={BTN}
              variant={options.mode === id ? "default" : "outline"}
              aria-pressed={options.mode === id}
              disabled={disabled}
              onClick={() => set({ mode: id })}
            >
              {title}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODES.find(([id]) => id === options.mode)?.[2]}</p>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">How</p>
        <div className="flex flex-wrap gap-2">
          {ENGINES.map(([id, title]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              className={BTN}
              variant={options.engine === id ? "default" : "outline"}
              aria-pressed={options.engine === id}
              disabled={disabled}
              onClick={() => set({ engine: id })}
            >
              {title}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{ENGINES.find(([id]) => id === options.engine)?.[2]}</p>
      </div>
      {options.engine === "vector" && options.mode === "dark" ? (
        <label className="flex items-center gap-2 text-sm font-medium text-ink">
          <input
            type="checkbox"
            className="size-4 accent-[var(--signal)]"
            checked={options.keepHues}
            disabled={disabled}
            onChange={(e) => set({ keepHues: e.target.checked })}
          />
          Keep the hues of pictures and shapes
        </label>
      ) : null}
      {options.engine === "vector" && options.mode === "dark" ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          Draws the page art a second time, without its text, so the file grows when a PDF has big pictures. Text colour is not kept.
        </p>
      ) : null}
      {options.engine === "raster" ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Resolution</p>
          <div className="flex flex-wrap gap-2">
            {[96, 150, 200, 300].map((dpi) => (
              <Button
                key={dpi}
                type="button"
                size="sm"
                className={BTN}
                variant={options.dpi === dpi ? "default" : "outline"}
                aria-pressed={options.dpi === dpi}
                disabled={disabled}
                onClick={() => set({ dpi })}
              >
                {dpi} DPI
              </Button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Preview of page 1</p>
        <div className="grid max-w-md grid-cols-2 gap-3">
          <figure className="space-y-1">
            <Preview session={session} mode={null} />
            <figcaption className="text-center text-xs text-muted-foreground">Before</figcaption>
          </figure>
          <figure className="space-y-1">
            <Preview session={session} mode={options.mode} />
            <figcaption className="text-center text-xs text-muted-foreground">After</figcaption>
          </figure>
        </div>
      </div>
    </div>
  );
}
