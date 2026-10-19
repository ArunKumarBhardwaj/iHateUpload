"use client";

import { useRef, useState } from "react";
import { Copy, FilePlus2, RotateCcw, RotateCw, Trash2 } from "lucide-react";

import { PageGrid, type GridPage } from "@/components/page-grid";
import { Button } from "@/components/ui/button";
import { normaliseTurn, reorderKeys } from "@/lib/page-tools/geometry";
import type { OrganizeEntry } from "@/lib/page-tools/types";
import type { ToolOptions } from "@/lib/tool-options";
import { usePdfSession } from "@/lib/use-pdf-session";

type OrganizeOptions = Extract<ToolOptions, { kind: "organize" }>;

const BTN = "h-10 sm:h-7";
const ICON = "size-9 sm:size-7";

export function OrganizePanel({
  options,
  onOptions,
  file,
  pageCount,
  disabled,
}: {
  options: OrganizeOptions;
  onOptions: (next: ToolOptions) => void;
  file: File | undefined;
  pageCount: number;
  disabled: boolean;
}) {
  const { session, pages: sizes } = usePdfSession(file);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const serial = useRef(0);
  const entries = options.entries;
  const set = (next: OrganizeEntry[]) => onOptions({ kind: "organize", entries: next });
  const fresh = (src: number, turn: OrganizeEntry["turn"]): OrganizeEntry => ({
    id: `n${++serial.current}`,
    src,
    turn,
  });

  const edited =
    entries.length !== pageCount ||
    entries.some((e, i) => e.src !== i || e.turn !== 0);

  if (pageCount === 0) {
    return <p className="text-sm text-muted-foreground">Reading the pages in this PDF…</p>;
  }

  const turnEntries = (ids: ReadonlySet<string>, by: number) =>
    set(entries.map((e) => (ids.has(e.id) && e.src >= 0 ? { ...e, turn: normaliseTurn(e.turn + by) } : e)));
  const remove = (ids: ReadonlySet<string>) => {
    const left = entries.filter((e) => !ids.has(e.id));
    if (!left.some((e) => e.src >= 0)) return;
    set(left);
    setSelected(new Set());
  };
  const duplicate = (ids: ReadonlySet<string>) => {
    const out: OrganizeEntry[] = [];
    for (const e of entries) {
      out.push(e);
      if (ids.has(e.id)) out.push(fresh(e.src, e.turn));
    }
    set(out);
  };
  const blankAfter = (id: string) => {
    const i = entries.findIndex((e) => e.id === id);
    const next = [...entries];
    next.splice(i + 1, 0, fresh(-1, 0));
    set(next);
  };

  const gridPages: GridPage[] = entries.map((e, i) => ({
    key: e.id,
    page: e.src,
    turn: e.turn,
    label: e.src < 0 ? `${i + 1} · blank` : e.src === i ? String(i + 1) : `${i + 1} · was ${e.src + 1}`,
  }));
  const ids = selected;
  const none = ids.size === 0;

  return (
    <div
      className="space-y-3"
      onKeyDown={(e) => {
        if (disabled || none) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          remove(ids);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-2 text-sm font-medium text-ink" aria-live="polite">
          {entries.length === pageCount ? `${pageCount} pages` : `${entries.length} pages (from ${pageCount})`}
        </p>
        <Button type="button" size="sm" variant="outline" className={BTN} disabled={disabled || none} onClick={() => turnEntries(ids, -90)} aria-label="Rotate selected left">
          <RotateCcw /> Left
        </Button>
        <Button type="button" size="sm" variant="outline" className={BTN} disabled={disabled || none} onClick={() => turnEntries(ids, 90)} aria-label="Rotate selected right">
          <RotateCw /> Right
        </Button>
        <Button type="button" size="sm" variant="outline" className={BTN} disabled={disabled || none} onClick={() => duplicate(ids)} aria-label="Duplicate selected">
          <Copy /> Duplicate
        </Button>
        <Button type="button" size="sm" variant="outline" className={BTN} disabled={disabled || none} onClick={() => remove(ids)} aria-label="Delete selected">
          <Trash2 /> Delete
        </Button>
        {edited ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={BTN}
            disabled={disabled}
            onClick={() => {
              setSelected(new Set());
              set(Array.from({ length: pageCount }, (_, i) => ({ id: `p${i}`, src: i, turn: 0 as const })));
            }}
          >
            <RotateCcw /> Reset
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        Drag a page to move it, or focus one and press Alt plus an arrow key. Select pages to act on several at once; Delete removes the selection.
      </p>
      <div className="max-h-[38rem] overflow-y-auto rounded-xl border border-ink/10 bg-secondary p-3">
        <PageGrid
          session={session}
          sizes={sizes}
          pages={gridPages}
          selected={selected}
          onSelected={setSelected}
          disabled={disabled}
          ariaLabel="Pages in the new order"
          onReorder={(keys, before) =>
            set(
              reorderKeys(entries.map((e) => e.id), keys, before).map(
                (id) => entries.find((e) => e.id === id)!,
              ),
            )
          }
          renderActions={(p) => {
            const only = new Set([p.key]);
            const real = p.page >= 0;
            const n = entries.findIndex((e) => e.id === p.key) + 1;
            return (
              <>
                {real ? (
                  <>
                    <Button type="button" size="icon-sm" variant="outline" className={ICON} disabled={disabled} aria-label={`Rotate position ${n} left`} onClick={() => turnEntries(only, -90)}>
                      <RotateCcw className="size-3.5" />
                    </Button>
                    <Button type="button" size="icon-sm" variant="outline" className={ICON} disabled={disabled} aria-label={`Rotate position ${n} right`} onClick={() => turnEntries(only, 90)}>
                      <RotateCw className="size-3.5" />
                    </Button>
                    <Button type="button" size="icon-sm" variant="outline" className={ICON} disabled={disabled} aria-label={`Duplicate position ${n}`} onClick={() => duplicate(only)}>
                      <Copy className="size-3.5" />
                    </Button>
                  </>
                ) : null}
                <Button type="button" size="icon-sm" variant="outline" className={ICON} disabled={disabled} aria-label={`Insert a blank page after position ${n}`} onClick={() => blankAfter(p.key)}>
                  <FilePlus2 className="size-3.5" />
                </Button>
                <Button type="button" size="icon-sm" variant="outline" className={ICON} disabled={disabled || entries.filter((e) => e.src >= 0).length <= (real ? 1 : 0)} aria-label={`Delete position ${n}`} onClick={() => remove(only)}>
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            );
          }}
        />
      </div>
    </div>
  );
}
