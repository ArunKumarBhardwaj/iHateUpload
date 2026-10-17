"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Crop, Plus, RotateCw, ScanLine, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { FileItem } from "@/lib/job";
import { createScanClient, type ScanClient } from "@/lib/scan/client";
import type { Pt, Quad, ScanPageEdit } from "@/lib/scan/types";
import type { ToolOptions } from "@/lib/tool-options";
import { cn } from "@/lib/utils";

type ScanOptions = Extract<ToolOptions, { kind: "scan" }>;

const FULL: Quad = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

function useObjectUrl(file: File | undefined) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ""), [file]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  return url;
}

function Thumb({ file }: { file: File }) {
  const url = useObjectUrl(file);
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-full w-full object-cover" />;
}

export function ScanStudio({
  files,
  options,
  onOptions,
  onFiles,
  onAddMore,
  disabled,
}: {
  files: FileItem[];
  options: ScanOptions;
  onOptions: (next: ScanOptions) => void;
  onFiles: (next: FileItem[]) => void;
  onAddMore: () => void;
  disabled: boolean;
}) {
  const clientRef = useRef<ScanClient | null>(null);
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const selected = files.find((f) => f.id === selectedId) ?? files[0];
  const edit: ScanPageEdit | undefined = selected ? options.pages[selected.id] : undefined;

  const client = useCallback(() => {
    if (!clientRef.current) clientRef.current = createScanClient();
    return clientRef.current;
  }, []);
  useEffect(
    () => () => {
      clientRef.current?.dispose();
      clientRef.current = null;
    },
    [],
  );

  const patchPage = useCallback(
    (id: string, patch: Partial<ScanPageEdit>) => {
      const cur = latest.current;
      const prev = cur.pages[id] ?? { corners: null, rotate: 0, detected: false };
      onOptions({ ...cur, pages: { ...cur.pages, [id]: { ...prev, ...patch } } });
    },
    [onOptions],
  );

  // Look for the page edges on every new photo, one at a time.
  const detecting = useRef(new Set<string>());
  useEffect(() => {
    const todo = files.find(
      (f) => !latest.current.pages[f.id]?.detected && !detecting.current.has(f.id),
    );
    if (!todo) return;
    detecting.current.add(todo.id);
    void client()
      .detect(todo.id, todo.file)
      .then((r) => patchPage(todo.id, { corners: r.corners, detected: true }))
      .catch(() => patchPage(todo.id, { corners: null, detected: true }));
  }, [files, options.pages, client, patchPage]);

  const src = useObjectUrl(selected?.file);
  const frame = useRef<HTMLDivElement>(null);
  const corners = edit?.corners ?? FULL;
  const dragging = useRef<number | null>(null);

  function pointFrom(e: React.PointerEvent): Pt {
    const box = frame.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }
  function moveHandle(e: React.PointerEvent) {
    if (dragging.current === null || !selected) return;
    const next = corners.map((p, i) => (i === dragging.current ? pointFrom(e) : p)) as Quad;
    patchPage(selected.id, { corners: next });
  }

  // Processed preview.
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const seq = useRef(0);
  const { filter, brightness, contrast } = options;
  const cornersKey = JSON.stringify(edit?.corners ?? null);
  const rotate = edit?.rotate ?? 0;
  const ready = Boolean(edit?.detected);
  useEffect(() => {
    if (!selected || !ready) return;
    const mine = ++seq.current;
    const timer = window.setTimeout(() => {
      setStatus("Updating preview…");
      client()
        .preview(
          selected.id,
          selected.file,
          {
            corners: JSON.parse(cornersKey) as Quad | null,
            rotate,
            filter,
            brightness,
            contrast,
          },
          760,
        )
        .then((img) => {
          if (mine !== seq.current) return;
          const canvas = canvasRef.current;
          if (!canvas) return;
          canvas.width = img.width;
          canvas.height = img.height;
          canvas
            .getContext("2d")
            ?.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
          setStatus("");
        })
        .catch(() => setStatus("This photo could not be read."));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [selected, ready, cornersKey, rotate, filter, brightness, contrast, client]);

  function remove(id: string) {
    client().forget(id);
    onFiles(files.filter((f) => f.id !== id));
  }
  function move(index: number, dir: -1 | 1) {
    const t = index + dir;
    if (t < 0 || t >= files.length) return;
    const next = [...files];
    [next[index], next[t]] = [next[t], next[index]];
    onFiles(next);
  }
  function redetect() {
    if (!selected) return;
    void client()
      .detect(selected.id, selected.file)
      .then((r) => {
        patchPage(selected.id, { corners: r.corners, detected: true });
        setStatus(r.corners ? "" : "No page edges found. The whole photo is kept.");
      });
  }

  if (!selected) return null;
  const index = files.indexOf(selected);
  const polygon = corners.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="space-y-4">
      <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Pages">
        {files.map((f, i) => (
          <li key={f.id} className="w-20 shrink-0">
            <button
              type="button"
              onClick={() => setSelectedId(f.id)}
              aria-label={`Page ${i + 1}`}
              aria-current={f.id === selected.id}
              className={cn(
                "relative block aspect-[3/4] w-full overflow-hidden rounded-lg border-2 bg-secondary",
                f.id === selected.id ? "border-signal" : "border-ink/10",
              )}
            >
              <Thumb file={f.file} />
              <span className="absolute bottom-1 left-1 rounded bg-ink/70 px-1.5 text-xs text-white">
                {i + 1}
              </span>
            </button>
          </li>
        ))}
        <li className="w-20 shrink-0">
          <button
            type="button"
            onClick={onAddMore}
            disabled={disabled}
            aria-label="Add a page"
            className="flex aspect-[3/4] w-full items-center justify-center rounded-lg border-2 border-dashed border-ink/15 text-muted-foreground hover:border-signal/40"
          >
            <Plus className="size-5" />
          </button>
        </li>
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={disabled || index === 0} onClick={() => move(index, -1)}>
          <ArrowLeft /> Earlier
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={disabled || index === files.length - 1} onClick={() => move(index, 1)}>
          Later <ArrowRight />
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={disabled} onClick={() => patchPage(selected.id, { rotate: (((rotate + 90) % 360) as 0 | 90 | 180 | 270) })}>
          <RotateCw /> Turn
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={disabled} onClick={redetect}>
          <ScanLine /> Find edges
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={disabled || !edit?.corners} onClick={() => patchPage(selected.id, { corners: null })}>
          <Crop /> Whole photo
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 sm:h-7" disabled={disabled} onClick={() => remove(selected.id)}>
          <X /> Delete page
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Drag the corners to the page edges</p>
          <div
            ref={frame}
            data-testid="scan-crop"
            className="relative mx-auto w-fit max-w-full touch-none select-none"
            onPointerMove={moveHandle}
            onPointerUp={() => (dragging.current = null)}
            onPointerCancel={() => (dragging.current = null)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`Photo ${index + 1}`} className="block max-h-[28rem] max-w-full rounded-lg" draggable={false} />
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
              <polygon points={polygon} fill="rgba(37,99,235,0.12)" stroke="rgb(37,99,235)" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            {corners.map((p, i) => (
              <button
                key={i}
                type="button"
                data-testid={`scan-handle-${i}`}
                aria-label={["Top left", "Top right", "Bottom right", "Bottom left"][i] + " corner"}
                disabled={disabled}
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                  dragging.current = i;
                }}
                style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                className="absolute size-7 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-white bg-signal shadow-md active:cursor-grabbing"
              />
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-ink">Result</p>
          <div className="relative mx-auto w-fit max-w-full">
            <canvas ref={canvasRef} data-testid="scan-preview" className="block max-h-[28rem] max-w-full rounded-lg border border-ink/10 bg-white" />
            {status ? <p className="mt-1 text-xs text-muted-foreground">{status}</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
