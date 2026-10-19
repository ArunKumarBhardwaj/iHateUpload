"use client";

import { useState } from "react";
import { RotateCcw, RotateCw } from "lucide-react";

import { PageGrid, type GridPage } from "@/components/page-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normaliseTurn } from "@/lib/page-tools/geometry";
import { resolvePageRange, type ToolOptions } from "@/lib/tool-options";
import { usePdfSession } from "@/lib/use-pdf-session";

type RotateOptions = Extract<ToolOptions, { kind: "rotate" }>;
type Turn = 0 | 90 | 180 | 270;

const BTN = "h-10 sm:h-7";

export function RotatePanel({
  options,
  onOptions,
  file,
  disabled,
}: {
  options: RotateOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  disabled: boolean;
}) {
  const { session, pages: sizes } = usePdfSession(file);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const count = sizes?.length ?? 0;

  let inRange = new Set<number>();
  let rangeError = false;
  if (count > 0) {
    try {
      inRange = new Set(resolvePageRange(options.range, count));
    } catch {
      rangeError = true;
    }
  }
  const perPage = options.perPage ?? {};
  const turnOf = (i: number): Turn =>
    normaliseTurn((inRange.has(i) ? options.degrees : 0) + (perPage[i] ?? 0));

  const turnPages = (indexes: number[], by: number) => {
    const next = { ...perPage };
    for (const i of indexes) {
      const t = normaliseTurn((next[i] ?? 0) + by);
      if (t === 0) delete next[i];
      else next[i] = t;
    }
    onOptions({ ...options, perPage: next });
  };
  const all = Array.from({ length: count }, (_, i) => i);
  const chosen = [...selected].map(Number);
  const turned = all.filter((i) => turnOf(i) !== 0).length;

  const gridPages: GridPage[] = all.map((i) => ({
    key: String(i),
    page: i,
    turn: turnOf(i),
  }));

  const group = (
    label: string,
    targets: number[],
    off: boolean,
  ) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-sm font-medium text-ink">{label}</span>
      {(
        [
          [-90, "left", <RotateCcw key="l" />],
          [90, "right", <RotateCw key="r" />],
          [180, "180°", null],
        ] as const
      ).map(([by, name, icon]) => (
        <Button
          key={by}
          type="button"
          size="sm"
          variant="outline"
          className={BTN}
          disabled={disabled || off}
          aria-label={`Rotate ${label.toLowerCase()} ${name}`}
          onClick={() => turnPages(targets, by)}
        >
          {icon} {name === "180°" ? "180°" : name === "left" ? "Left" : "Right"}
        </Button>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {group("All pages", all, count === 0)}
        {group("Selected", chosen, chosen.length === 0)}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={BTN}
          disabled={disabled || (turned === 0 && options.degrees === 0)}
          onClick={() => {
            setSelected(new Set());
            onOptions({ ...options, perPage: {}, degrees: 0 });
          }}
        >
          Reset
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {turned === 0 ? "No page turned yet" : `${turned} page${turned === 1 ? "" : "s"} turned`}
        </p>
      </div>

      <div className="max-h-[34rem] overflow-y-auto rounded-xl border border-ink/10 bg-secondary p-3">
        {count === 0 ? (
          <p className="text-sm text-muted-foreground">Reading the pages in this PDF…</p>
        ) : (
          <PageGrid
            session={session}
            sizes={sizes}
            pages={gridPages}
            selected={selected}
            onSelected={setSelected}
            disabled={disabled}
            ariaLabel="Pages. Select pages, then turn them."
            renderActions={(p) => (
              <>
                {(
                  [
                    [-90, "left", <RotateCcw key="l" className="size-3.5" />],
                    [90, "right", <RotateCw key="r" className="size-3.5" />],
                  ] as const
                ).map(([by, name, icon]) => (
                  <Button
                    key={by}
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="size-9 sm:size-7"
                    disabled={disabled}
                    aria-label={`Turn page ${p.page + 1} ${name}`}
                    onClick={() => turnPages([p.page], by)}
                  >
                    {icon}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 px-2 text-xs sm:h-7"
                  disabled={disabled}
                  aria-label={`Turn page ${p.page + 1} 180 degrees`}
                  onClick={() => turnPages([p.page], 180)}
                >
                  180°
                </Button>
              </>
            )}
          />
        )}
      </div>

      <div className="space-y-3 border-t border-ink/10 pt-4">
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Also turn a page range by</p>
          <div className="flex flex-wrap gap-2">
            {([0, 90, 180, 270] as const).map((degrees) => (
              <Button
                key={degrees}
                type="button"
                size="sm"
                className={BTN}
                variant={options.degrees === degrees ? "default" : "outline"}
                aria-pressed={options.degrees === degrees}
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
                className={BTN}
                variant={options.flip === flip ? "default" : "outline"}
                aria-pressed={options.flip === flip}
                disabled={disabled}
                onClick={() => onOptions({ ...options, flip })}
              >
                {label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Turns and mirrors keep text as text, not a picture. Mirror and the range turn use the pages below.
          </p>
        </div>
        <div className="max-w-sm space-y-1">
          <label htmlFor="rotate-range" className="text-sm font-medium text-ink">
            Pages for the range turn and mirror
          </label>
          <Input
            id="rotate-range"
            value={options.range}
            disabled={disabled}
            aria-invalid={rangeError}
            onChange={(e) => onOptions({ ...options, range: e.target.value })}
            placeholder="All pages, or e.g. 1-3, 7"
            inputMode="text"
            autoComplete="off"
          />
        </div>
      </div>
    </div>
  );
}
