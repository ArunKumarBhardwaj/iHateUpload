"use client";

import { useEffect, useRef, useState } from "react";

import { loadPdfJs } from "@/lib/pdfjs";
import { cn } from "@/lib/utils";

const MAX_THUMBS = 300;

/**
 * Filmstrip of page thumbnails for editors that work one page at a time.
 * Pages render one after another in this tab and are cleaned up when the file changes.
 */
export function PageStrip({
  file,
  pageCount,
  current,
  onSelect,
  badges,
  disabled,
}: {
  file: File;
  pageCount: number;
  current: number;
  onSelect: (pageIndex: number) => void;
  /** Number of items on each page, shown as a dot count. */
  badges?: Record<number, number>;
  disabled?: boolean;
}) {
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const [seenFile, setSeenFile] = useState(file);
  const urls = useRef<string[]>([]);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  if (seenFile !== file) {
    setSeenFile(file);
    setThumbs({});
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getDocument } = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await getDocument({ data }).promise;
      try {
        const total = Math.min(doc.numPages, MAX_THUMBS);
        for (let n = 1; n <= total && !cancelled; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 96 / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          page.cleanup();
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, "image/jpeg", 0.7),
          );
          canvas.width = 0;
          canvas.height = 0;
          if (!blob || cancelled) continue;
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          setThumbs((prev) => ({ ...prev, [n - 1]: url }));
        }
      } finally {
        await doc.loadingTask.destroy();
      }
    })();
    return () => {
      cancelled = true;
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = [];
    };
  }, [file]);

  useEffect(() => {
    itemRefs.current[current]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [current]);

  if (pageCount < 2) return null;
  return (
    <nav
      aria-label="Pages"
      className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[640px] lg:w-24 lg:shrink-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto lg:pb-0"
    >
      {Array.from({ length: pageCount }, (_, index) => (
        <button
          key={index}
          ref={(node) => {
            itemRefs.current[index] = node;
          }}
          type="button"
          disabled={disabled}
          aria-label={`Page ${index + 1}`}
          aria-current={index === current ? "page" : undefined}
          onClick={() => onSelect(index)}
          className={cn(
            "relative w-16 shrink-0 overflow-hidden rounded-md border bg-card text-xs lg:w-20",
            index === current
              ? "border-signal ring-2 ring-signal/40"
              : "border-ink/15 hover:border-ink/40",
          )}
        >
          {thumbs[index] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumbs[index]} alt="" className="block w-full" />
          ) : (
            <span className="flex aspect-[3/4] items-center justify-center text-muted-foreground">
              {index + 1}
            </span>
          )}
          <span className="absolute bottom-0.5 left-0.5 rounded bg-ink/70 px-1 text-[10px] text-card">
            {index + 1}
          </span>
          {badges?.[index] ? (
            <span className="absolute top-0.5 right-0.5 rounded-full bg-signal px-1.5 text-[10px] font-semibold text-white">
              {badges[index]}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}
