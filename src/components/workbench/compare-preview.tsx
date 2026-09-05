"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { loadPdfJs } from "@/lib/pdfjs";

export function ComparePreview({
  left,
  right,
  leftPages,
  rightPages,
  pageIndex,
  onPageIndex,
  disabled,
}: {
  left: File;
  right: File;
  leftPages: number;
  rightPages: number;
  pageIndex: number;
  onPageIndex: (pageIndex: number) => void;
  disabled: boolean;
}) {
  const last = Math.max(leftPages, rightPages, 1) - 1;
  const safeIndex = Math.min(pageIndex, last);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">Same page in both files</p>
        {last > 0 ? (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 sm:h-7"
              disabled={disabled || safeIndex <= 0}
              onClick={() => onPageIndex(safeIndex - 1)}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {safeIndex + 1} of {last + 1}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 sm:h-7"
              disabled={disabled || safeIndex >= last}
              onClick={() => onPageIndex(safeIndex + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <PagePane file={left} pageIndex={safeIndex} pages={leftPages} label={left.name} />
        <PagePane file={right} pageIndex={safeIndex} pages={rightPages} label={right.name} />
      </div>
    </div>
  );
}

function PagePane({
  file,
  pageIndex,
  pages,
  label,
}: {
  file: File;
  pageIndex: number;
  pages: number;
  label: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const missing = pages > 0 && pageIndex >= pages;

  useEffect(() => {
    if (missing) {
      setUrl(null);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    void (async () => {
      const { getDocument } = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await getDocument({ data }).promise;
      try {
        if (pageIndex >= doc.numPages) return;
        const page = await doc.getPage(pageIndex + 1);
        const viewport = page.getViewport({ scale: 1.05 });
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
          canvas.toBlob(resolve, "image/jpeg", 0.82);
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
  }, [file, pageIndex, missing]);

  return (
    <div className="space-y-2">
      <p className="truncate text-xs font-medium text-muted-foreground" title={label}>
        {label}
      </p>
      <div className="overflow-hidden rounded-xl border border-ink/10 bg-muted/40">
        {missing ? (
          <div className="flex aspect-[3/4] items-center justify-center px-4 text-center text-sm text-muted-foreground">
            This file has no page {pageIndex + 1}.
          </div>
        ) : url ? (
          // Synced pair. The image is the page, not a control.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="block w-full select-none" />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center text-sm text-muted-foreground">
            Reading the page…
          </div>
        )}
      </div>
    </div>
  );
}
