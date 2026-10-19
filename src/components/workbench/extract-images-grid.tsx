"use client";

import { useEffect, useState } from "react";
import { Download, ImageOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { imageFileName, scanFileImages } from "@/lib/extract-images";
import {
  filterBySize,
  IMAGE_MIME,
  type ExtractedImage,
  type ImageScan,
} from "@/lib/pdf-images";
import type { ToolOptions } from "@/lib/tool-options";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";

type Scan =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ready"; scan: ImageScan };

function Tile({
  image,
  name,
  checked,
  disabled,
  onToggle,
}: {
  image: ExtractedImage;
  name: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (image.format === "jp2") return;
    const made = URL.createObjectURL(
      new Blob([image.bytes as BlobPart], { type: IMAGE_MIME[image.format] }),
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URLs must be made and revoked as a pair
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [image]);
  const [broken, setBroken] = useState(false);
  return (
    <li
      className={cn(
        "overflow-hidden rounded-lg border bg-card",
        checked ? "border-signal/60" : "border-ink/10 opacity-60",
      )}
    >
      <label className="relative block aspect-square cursor-pointer bg-[conic-gradient(#0000000d_25%,transparent_0_50%,#0000000d_0_75%,transparent_0)] bg-[length:16px_16px]">
        <input
          type="checkbox"
          className="absolute left-2 top-2 z-10 size-5"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Include ${name}`}
        />
        {url && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={name}
            loading="lazy"
            decoding="async"
            className="size-full object-contain"
            onError={() => setBroken(true)}
          />
        ) : (
          <span className="flex size-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <ImageOff className="size-5" />
            No preview
          </span>
        )}
      </label>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          <span className="block font-medium text-ink">
            {image.width} x {image.height}
          </span>
          {image.format.toUpperCase()} · {formatBytes(image.bytes.length)} · p.
          {image.page}
        </p>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8"
          aria-label={`Download ${name}`}
          onClick={() =>
            downloadBlob(
              new Blob([image.bytes as BlobPart], { type: IMAGE_MIME[image.format] }),
              name,
            )
          }
        >
          <Download className="size-4" />
        </Button>
      </div>
    </li>
  );
}

export function ExtractImagesGrid({
  file,
  baseName,
  options,
  onOptions,
  disabled,
}: {
  file: File;
  baseName: string;
  options: Extract<ToolOptions, { kind: "extract-images" }>;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
}) {
  const [scan, setScan] = useState<Scan>({ state: "loading" });
  useEffect(() => {
    let live = true;
    scanFileImages(file).then(
      (result) => live && setScan({ state: "ready", scan: result }),
      (error: unknown) =>
        live &&
        setScan({
          state: "error",
          message: error instanceof Error ? error.message : "Could not read the PDF.",
        }),
    );
    return () => {
      live = false;
    };
  }, [file]);

  if (scan.state === "loading") {
    return <p className="text-sm text-muted-foreground">Looking for pictures…</p>;
  }
  if (scan.state === "error") {
    return <p className="text-sm text-destructive">{scan.message}</p>;
  }
  if (scan.scan.images.length === 0) {
    return (
      <p className="rounded-lg border border-ink/10 bg-secondary px-3 py-3 text-sm text-muted-foreground">
        This PDF has no embedded pictures. Pages drawn as vector art or text
        are not images; use PDF to JPG to turn pages into pictures.
      </p>
    );
  }
  const shown = filterBySize(scan.scan.images, options.minEdge);
  const picked = shown.filter((image) => !options.excluded.includes(image.id));
  const toggle = (id: string) =>
    onOptions({
      ...options,
      excluded: options.excluded.includes(id)
        ? options.excluded.filter((x) => x !== id)
        : [...options.excluded, id],
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <p className="flex-1 font-medium text-ink">
          {picked.length} of {shown.length} picture
          {shown.length === 1 ? "" : "s"} selected
          {shown.length < scan.scan.images.length
            ? ` (${scan.scan.images.length - shown.length} hidden by size)`
            : ""}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onOptions({ ...options, excluded: [] })}
        >
          Select all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() =>
            onOptions({ ...options, excluded: shown.map((image) => image.id) })
          }
        >
          None
        </Button>
      </div>
      {scan.scan.skipped.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {scan.scan.skipped.length} picture
          {scan.scan.skipped.length === 1 ? " uses" : "s use"} an encoding that
          cannot be exported.
        </p>
      ) : null}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {shown.map((image, index) => (
          <Tile
            key={image.id}
            image={image}
            name={imageFileName(baseName, image, index)}
            checked={!options.excluded.includes(image.id)}
            disabled={disabled}
            onToggle={() => toggle(image.id)}
          />
        ))}
      </ul>
    </div>
  );
}
