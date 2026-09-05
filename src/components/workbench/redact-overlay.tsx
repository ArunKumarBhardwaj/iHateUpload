"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { loadPdfJs } from "@/lib/pdfjs";
import type { PageBox } from "@/lib/tool-options";
import { cn } from "@/lib/utils";

type DragState =
  | {
      kind: "draw";
      startX: number;
      startY: number;
      pageIndex: number;
    }
  | {
      kind: "move" | "se";
      startX: number;
      startY: number;
      index: number;
      origin: PageBox;
    };

export function RedactOverlay({
  file,
  boxes,
  onBoxes,
  pageCount,
  disabled,
}: {
  file: File;
  boxes: PageBox[];
  onBoxes: (boxes: PageBox[]) => void;
  pageCount: number;
  disabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [draft, setDraft] = useState<PageBox | null>(null);
  const draftRef = useRef<PageBox | null>(null);
  const [seenFile, setSeenFile] = useState(file);
  if (file !== seenFile) {
    setSeenFile(file);
    setPageIndex(0);
    setSelected(null);
    draftRef.current = null;
    setDraft(null);
  }
  if (pageCount > 0 && pageIndex >= pageCount) {
    setPageIndex(pageCount - 1);
  }

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    void (async () => {
      const { getDocument } = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await getDocument({ data }).promise;
      try {
        const safeIndex = Math.min(pageIndex, Math.max(0, doc.numPages - 1));
        const page = await doc.getPage(safeIndex + 1);
        const viewport = page.getViewport({ scale: 1.15 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        page.cleanup();
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", 0.86);
        });
        canvas.width = 0;
        canvas.height = 0;
        if (!blob || cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      } finally {
        await doc.loadingTask.destroy();
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file, pageIndex]);

  const visible = boxes
    .map((box, index) => ({ box, index }))
    .filter(({ box }) => box.pageIndex === pageIndex);

  const ratioOf = (event: React.PointerEvent<HTMLElement>) => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const replaceBox = (index: number, next: PageBox) => {
    onBoxes(boxes.map((box, i) => (i === index ? next : box)));
  };

  const onHostPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = ratioOf(event);
    drag.current = {
      kind: "draw",
      startX: start.x,
      startY: start.y,
      pageIndex,
    };
    setSelected(null);
    const next = { pageIndex, x: start.x, y: start.y, w: 0, h: 0 };
    draftRef.current = next;
    setDraft(next);
  };

  const onBoxPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    index: number,
    kind: "move" | "se",
  ) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelected(index);
    draftRef.current = null;
    setDraft(null);
    drag.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      index,
      origin: { ...boxes[index] },
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const active = drag.current;
    const host = hostRef.current;
    if (!active || !host) return;
    if (active.kind === "draw") {
      const now = ratioOf(event);
      const next = normalizeDraft(
        active.startX,
        active.startY,
        now.x,
        now.y,
        active.pageIndex,
      );
      draftRef.current = next;
      setDraft(next);
      return;
    }
    const rect = host.getBoundingClientRect();
    const dx = (event.clientX - active.startX) / rect.width;
    const dy = (event.clientY - active.startY) / rect.height;
    if (active.kind === "move") {
      replaceBox(active.index, {
        ...active.origin,
        x: clamp(active.origin.x + dx, 0, 1 - active.origin.w),
        y: clamp(active.origin.y + dy, 0, 1 - active.origin.h),
      });
      return;
    }
    replaceBox(active.index, {
      ...active.origin,
      w: clamp(active.origin.w + dx, 0.06, 1 - active.origin.x),
      h: clamp(active.origin.h + dy, 0.04, 1 - active.origin.y),
    });
  };

  const endDrag = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.kind !== "draw") return;
    const next = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!next || next.w <= 0.04 || next.h <= 0.04) return;
    onBoxes([...boxes, next]);
    setSelected(boxes.length);
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">Draw boxes to destroy</p>
      {pageCount > 1 ? (
        <label className="flex items-center gap-2 text-sm font-medium text-ink" htmlFor="redact-page">
          Page
          <Input
            id="redact-page"
            type="number"
            min={1}
            max={pageCount}
            value={pageIndex + 1}
            disabled={disabled}
            className="h-10 w-20 sm:h-8"
            onChange={(e) => {
              const page = Number(e.target.value);
              if (!Number.isInteger(page)) return;
              setPageIndex(Math.min(pageCount, Math.max(1, page)) - 1);
              setSelected(null);
            }}
          />
          <span className="font-normal text-muted-foreground">of {pageCount}</span>
        </label>
      ) : null}
      <div
        ref={hostRef}
        className={cn(
          "relative overflow-hidden rounded-xl border border-ink/10 bg-muted/40",
          disabled ? "cursor-default" : "cursor-crosshair",
        )}
        onPointerDown={onHostPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {url ? (
          // The boxes are the control. The page image is the map.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="block w-full select-none" />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center text-sm text-muted-foreground">
            Reading the page…
          </div>
        )}
        {visible.map(({ box, index }) => (
          <div
            key={index}
            role="button"
            aria-label={`Redaction ${index + 1}`}
            aria-pressed={selected === index}
            className={cn(
              "absolute border-2 bg-black/80",
              selected === index ? "border-signal" : "border-ink/70",
              disabled ? "cursor-default" : "cursor-move",
            )}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.w * 100}%`,
              height: `${box.h * 100}%`,
            }}
            onPointerDown={(event) => onBoxPointerDown(event, index, "move")}
          >
            {selected === index && !disabled ? (
              <>
                <button
                  type="button"
                  aria-label="Delete box"
                  className="absolute -top-2 -right-2 inline-flex size-10 items-center justify-center rounded-full border border-ink/20 bg-card text-ink sm:size-5"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onBoxes(boxes.filter((_, i) => i !== index));
                    setSelected(null);
                  }}
                >
                  <X className="size-3" />
                </button>
                <button
                  type="button"
                  aria-label="Resize"
                  className="absolute -bottom-2 -right-2 size-10 rounded-full border border-signal bg-card sm:size-5"
                  onPointerDown={(event) => onBoxPointerDown(event, index, "se")}
                />
              </>
            ) : null}
          </div>
        ))}
        {draft && draft.w > 0 && draft.h > 0 ? (
          <div
            className="pointer-events-none absolute border-2 border-dashed border-signal bg-black/50"
            style={{
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              width: `${draft.w * 100}%`,
              height: `${draft.h * 100}%`,
            }}
          />
        ) : null}
      </div>
    </div>
  );
}

function normalizeDraft(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  pageIndex: number,
): PageBox {
  const x = clamp(Math.min(ax, bx), 0, 1);
  const y = clamp(Math.min(ay, by), 0, 1);
  const x2 = clamp(Math.max(ax, bx), 0, 1);
  const y2 = clamp(Math.max(ay, by), 0, 1);
  return { pageIndex, x, y, w: x2 - x, h: y2 - y };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
