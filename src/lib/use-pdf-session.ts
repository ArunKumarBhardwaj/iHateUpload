"use client";

import { useEffect, useState } from "react";

import type { PDFDocumentProxy } from "pdfjs-dist";

import { loadPdfJs } from "@/lib/pdfjs";

export type ShownPage = {
  /** Size in points as shown, after the page's own /Rotate. */
  width: number;
  height: number;
};

/**
 * One open pdf.js document with a serial render queue. Thumbnails are cached as
 * object URLs until `destroy`, so a card that scrolls away and back is instant.
 */
export class PdfSession {
  private doc: Promise<PDFDocumentProxy>;
  private queue: Promise<unknown> = Promise.resolve();
  private thumbs = new Map<number, Promise<string>>();
  private images = new Map<string, Promise<string>>();
  private urls: string[] = [];
  private dead = false;
  readonly pages: Promise<ShownPage[]>;

  constructor(file: Blob) {
    this.doc = (async () => {
      const { getDocument } = await loadPdfJs();
      return getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
        .promise;
    })();
    this.pages = this.doc.then(async (doc) => {
      const out: ShownPage[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const v = page.getViewport({ scale: 1 });
        out.push({ width: v.width, height: v.height });
        page.cleanup();
      }
      return out;
    });
    // A rejected open is reported through `pages`; keep the queue alive.
    this.doc.catch(() => undefined);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(() => (this.dead ? Promise.reject(new Error("closed")) : job()));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async render(
    pageIndex: number,
    width: number,
    filter?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  ): Promise<string> {
    const doc = await this.doc;
    const page = await doc.getPage(pageIndex + 1);
    try {
      const unscaled = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / unscaled.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas is not available in this browser.");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      filter?.(ctx, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      canvas.width = 0;
      canvas.height = 0;
      if (!blob) throw new Error("Could not encode the page.");
      const url = URL.createObjectURL(blob);
      if (this.dead) {
        URL.revokeObjectURL(url);
        throw new Error("closed");
      }
      this.urls.push(url);
      return url;
    } finally {
      page.cleanup();
    }
  }

  thumb(pageIndex: number): Promise<string> {
    let hit = this.thumbs.get(pageIndex);
    if (!hit) {
      hit = this.enqueue(() => this.render(pageIndex, 300));
      this.thumbs.set(pageIndex, hit);
    }
    return hit;
  }

  /** A larger render for editors and previews; cached per width like thumbnails. */
  image(
    pageIndex: number,
    width: number,
    filter?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
    key = "",
  ): Promise<string> {
    const id = `${pageIndex}:${width}:${key}`;
    let hit = this.images.get(id);
    if (!hit) {
      hit = this.enqueue(() => this.render(pageIndex, width, filter));
      this.images.set(id, hit);
    }
    return hit;
  }

  destroy() {
    this.dead = true;
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls = [];
    void this.doc.then((doc) => doc.loadingTask.destroy()).catch(() => undefined);
  }
}

/** Opens `file` for page thumbnails; `pages` is null until the page sizes are known. */
export function usePdfSession(file: File | undefined): {
  session: PdfSession | null;
  pages: ShownPage[] | null;
  failed: boolean;
} {
  const [state, setState] = useState<{
    session: PdfSession | null;
    pages: ShownPage[] | null;
    failed: boolean;
    file: File | undefined;
  }>({ session: null, pages: null, failed: false, file: undefined });

  useEffect(() => {
    if (!file) return;
    const session = new PdfSession(file);
    let cancelled = false;
    void session.pages.then(
      (pages) => {
        if (!cancelled) setState({ session, pages, failed: false, file });
      },
      () => {
        if (!cancelled) setState({ session, pages: null, failed: true, file });
      },
    );
    return () => {
      cancelled = true;
      session.destroy();
    };
  }, [file]);

  // A stale session belongs to an older file; hide it until the new one reports.
  if (state.file !== file) return { session: null, pages: null, failed: false };
  return state;
}
