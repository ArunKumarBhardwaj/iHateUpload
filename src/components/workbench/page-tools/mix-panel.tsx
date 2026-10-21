"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileItem } from "@/lib/job";
import { planAlternateMix, type MixLeftover } from "@/lib/page-tools/alternate-mix";
import type { ToolOptions } from "@/lib/tool-options";

const BTN = "h-10 sm:h-7";
const PREVIEW_LIMIT = 48;

type MixOptions = Extract<ToolOptions, { kind: "alternate-mix" }>;

/** A, B, C ... Z, then AA. */
function letter(index: number) {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

export function MixPanel({
  options,
  onOptions,
  files,
  filePages,
  disabled,
}: {
  options: MixOptions;
  onOptions: (next: ToolOptions) => void;
  files: FileItem[];
  filePages: number[];
  disabled: boolean;
}) {
  const take = (id: string) => options.take[id] ?? 1;
  const known = files.length >= 2 && filePages.length === files.length && filePages.every((n) => n > 0);
  let order: string[] | null = null;
  let note = "";
  if (known) {
    try {
      const plan = planAlternateMix(
        files.map((f, i) => ({ pages: filePages[i], take: take(f.id), reverse: options.reverse.includes(f.id) })),
        options.leftover,
      );
      order = plan.slice(0, PREVIEW_LIMIT).map((s) => `${letter(s.file)}${s.page + 1}`);
      note = plan.length > PREVIEW_LIMIT ? ` … ${plan.length} pages in all` : ` · ${plan.length} pages`;
    } catch (error) {
      note = error instanceof Error ? error.message : "";
    }
  }

  const set = (patch: Partial<Omit<MixOptions, "kind">>) => onOptions({ ...options, ...patch });
  const toggleReverse = (id: string) =>
    set({ reverse: options.reverse.includes(id) ? options.reverse.filter((r) => r !== id) : [...options.reverse, id] });
  const duplex = () =>
    set({
      take: {},
      reverse: files.slice(1).map((f) => f.id),
    });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Quick setups</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={BTN}
            disabled={disabled}
            onClick={() => set({ take: {}, reverse: [] })}
          >
            One page each, in order
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={BTN}
            disabled={disabled || files.length < 2}
            onClick={duplex}
            title="Fronts in order, backs scanned in reverse: reverses every file after the first."
          >
            Duplex scan (backs reversed)
          </Button>
        </div>
      </div>

      <ul className="space-y-2">
        {files.map((file, index) => {
          const reversed = options.reverse.includes(file.id);
          return (
            <li
              key={file.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-ink/10 bg-background p-2.5"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-signal/10 text-xs font-semibold text-signal">
                {letter(index)}
              </span>
              <span className="min-w-0 flex-1 text-xs">
                <span className="block truncate font-medium text-ink" title={file.name}>
                  {file.name}
                </span>
                <span className="text-muted-foreground">
                  {filePages[index] > 0 ? `${filePages[index]} pages` : "reading…"}
                </span>
              </span>
              <label className="flex items-center gap-1.5 text-xs text-ink">
                Pages per turn
                <Input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={999}
                  className="h-10 w-16 sm:h-8"
                  value={take(file.id)}
                  disabled={disabled}
                  aria-label={`Pages per turn from ${file.name}`}
                  onChange={(e) => {
                    const n = Math.floor(Number(e.target.value));
                    if (Number.isFinite(n)) set({ take: { ...options.take, [file.id]: Math.min(999, Math.max(1, n)) } });
                  }}
                />
              </label>
              <Button
                type="button"
                size="sm"
                className={BTN}
                variant={reversed ? "default" : "outline"}
                aria-pressed={reversed}
                aria-label={`Read ${file.name} last page first`}
                disabled={disabled}
                onClick={() => toggleReverse(file.id)}
              >
                Reverse
              </Button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">When a file is shorter</p>
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["append", "Keep the rest of the longer files"],
              ["stop", "Stop at the shortest"],
            ] as [MixLeftover, string][]
          ).map(([id, title]) => (
            <Button
              key={id}
              type="button"
              size="sm"
              className={BTN}
              variant={options.leftover === id ? "default" : "outline"}
              aria-pressed={options.leftover === id}
              disabled={disabled}
              onClick={() => set({ leftover: id })}
            >
              {title}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1" aria-live="polite">
        <p className="text-sm font-medium text-ink">Resulting order</p>
        {order ? (
          <p className="text-xs leading-relaxed text-muted-foreground" data-testid="mix-order">
            {order.join(" ")}
            {note}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{note || "Add two PDFs to see the order."}</p>
        )}
        <p className="text-xs text-muted-foreground">A2 means page 2 of file A. Change the file order with the arrows on the cards.</p>
      </div>
    </div>
  );
}
