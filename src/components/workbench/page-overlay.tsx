"use client";

import { useEffect, useRef, useState } from "react";

import { loadPdfJs } from "@/lib/pdfjs";
import type { PageBox } from "@/lib/tool-options";
import { cn } from "@/lib/utils";

type DragKind = "move" | "se";

export function PageOverlay({
  file,
  box,
  onBox,
  disabled,
  label,
}: {
  file: File;
  box: PageBox;
  onBox: (box: PageBox) => void;
  disabled: boolean;
  label: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    kind: DragKind;
    startX: number;
    startY: number;
    origin: PageBox;
  } | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    void (async () => {
      const { getDocument } = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await getDocument({ data }).promise;
      try {
        const page = await doc.getPage(box.pageIndex + 1);
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
  }, [file, box.pageIndex]);

  const onPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    kind: DragKind,
  ) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...box },
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const active = drag.current;
    const host = hostRef.current;
    if (!active || !host) return;
    const rect = host.getBoundingClientRect();
    const dx = (event.clientX - active.startX) / rect.width;
    const dy = (event.clientY - active.startY) / rect.height;
    if (active.kind === "move") {
      onBox({
        ...box,
        x: clamp(active.origin.x + dx, 0, 1 - box.w),
        y: clamp(active.origin.y + dy, 0, 1 - box.h),
      });
      return;
    }
    onBox({
      ...box,
      w: clamp(active.origin.w + dx, 0.06, 1 - active.origin.x),
      h: clamp(active.origin.h + dy, 0.04, 1 - active.origin.y),
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">{label}</p>
      <div
        ref={hostRef}
        className="relative overflow-hidden rounded-xl border border-ink/10 bg-muted/40"
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {url ? (
          // The overlay box is the control. The page image is the map.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="block w-full select-none" />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center text-sm text-muted-foreground">
            Reading the page…
          </div>
        )}
        <div
          role="slider"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(box.x * 100)}
          aria-valuetext={`Left ${Math.round(box.x * 100)} percent, top ${Math.round(box.y * 100)} percent`}
          className={cn(
            "absolute rounded-md border-2 border-signal bg-signal/15",
            disabled ? "cursor-default" : "cursor-move",
          )}
          style={{
            left: `${box.x * 100}%`,
            top: `${box.y * 100}%`,
            width: `${box.w * 100}%`,
            height: `${box.h * 100}%`,
          }}
          onPointerDown={(event) => onPointerDown(event, "move")}
        >
          <button
            type="button"
            aria-label="Resize"
            className="absolute -bottom-2 -right-2 size-10 rounded-full border border-signal bg-card sm:size-5"
            disabled={disabled}
            onPointerDown={(event) => onPointerDown(event, "se")}
          />
        </div>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
