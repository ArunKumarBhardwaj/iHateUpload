"use client";

import { useEffect, useState } from "react";

import type { FileItem } from "@/lib/job";
import {
  imagePreview,
  pdfPreview,
  renderPdfPages,
  revokeThumbnail,
  UNAVAILABLE_THUMBNAIL,
  type FilePreview,
  type ThumbnailState,
} from "@/lib/preview";
import type { ToolDefinition } from "@/lib/tools";

/**
 * Thumbnails past these counts are skipped. A 200-file merge or a 400-page scan
 * would otherwise decode every one of them on a phone.
 */
export const FILE_THUMBNAIL_LIMIT = 24;
export const PAGE_THUMBNAIL_LIMIT = 60;

/**
 * Renders carry the selection they belong to. A map from an older selection is
 * discarded on read, so nothing has to be cleared before the next one starts.
 */
type Rendered<K, V> = { generation: string; entries: ReadonlyMap<K, V> };

const NO_FILE_PREVIEWS: Rendered<string, FilePreview> = {
  generation: "",
  entries: new Map(),
};

const NO_PAGE_PREVIEWS: Rendered<number, ThumbnailState> = {
  generation: "",
  entries: new Map(),
};

function merge<K, V>(
  prev: Rendered<K, V>,
  generation: string,
  key: K,
  value: V,
): Rendered<K, V> {
  const entries = new Map(
    prev.generation === generation ? prev.entries : undefined,
  );
  entries.set(key, value);
  return { generation, entries };
}

/**
 * One thumbnail per selected file, rendered in order so the browser only holds
 * one decode at a time. A file with no entry yet reads as pending. Every URL
 * handed out is revoked when the selection changes or the component unmounts.
 */
export function useFilePreviews(
  files: FileItem[],
  kind: ToolDefinition["kind"],
): ReadonlyMap<string, FilePreview> {
  const [rendered, setRendered] =
    useState<Rendered<string, FilePreview>>(NO_FILE_PREVIEWS);
  const generation = files.map((file) => file.id).join("|");

  useEffect(() => {
    if (files.length === 0) return;

    const targets = files.slice(0, FILE_THUMBNAIL_LIMIT);
    const handedOut: ThumbnailState[] = [];
    let cancelled = false;

    void (async () => {
      for (const item of targets) {
        const preview =
          kind === "pdf"
            ? await pdfPreview(item.file)
            : await imagePreview(item.file);
        if (cancelled) {
          revokeThumbnail(preview.thumbnail);
          return;
        }
        handedOut.push(preview.thumbnail);
        setRendered((prev) => merge(prev, generation, item.id, preview));
      }
    })();

    return () => {
      cancelled = true;
      for (const thumbnail of handedOut) revokeThumbnail(thumbnail);
    };
  }, [files, generation, kind]);

  return rendered.generation === generation
    ? rendered.entries
    : NO_FILE_PREVIEWS.entries;
}

/** Page thumbnails for the Organize grid, keyed by zero-based page index. */
export function usePagePreviews(
  file: FileItem | undefined,
  pageCount: number,
): ReadonlyMap<number, ThumbnailState> {
  const [rendered, setRendered] =
    useState<Rendered<number, ThumbnailState>>(NO_PAGE_PREVIEWS);
  const generation = file && pageCount > 0 ? `${file.id}:${pageCount}` : "";

  useEffect(() => {
    if (!file || pageCount === 0) return;

    const pageNumbers = Array.from(
      { length: Math.min(pageCount, PAGE_THUMBNAIL_LIMIT) },
      (_, index) => index + 1,
    );
    const handedOut: ThumbnailState[] = [];
    let cancelled = false;

    void renderPdfPages(
      file.file,
      pageNumbers,
      (pageNumber, thumbnail) => {
        handedOut.push(thumbnail);
        setRendered((prev) =>
          merge(prev, generation, pageNumber - 1, thumbnail),
        );
      },
      () => cancelled,
    ).catch(() => {
      if (cancelled) return;
      setRendered({
        generation,
        entries: new Map(
          pageNumbers.map((number) => [number - 1, UNAVAILABLE_THUMBNAIL]),
        ),
      });
    });

    return () => {
      cancelled = true;
      for (const thumbnail of handedOut) revokeThumbnail(thumbnail);
    };
  }, [file, generation, pageCount]);

  return rendered.generation === generation
    ? rendered.entries
    : NO_PAGE_PREVIEWS.entries;
}
