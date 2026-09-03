"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

import type { ThumbnailState } from "@/lib/preview";
import { cn } from "@/lib/utils";

/**
 * Object-URL thumbnails cannot go through `next/image`, so this renders a plain
 * `<img>` and keeps the three preview states in one exhaustive switch.
 */
export function Thumbnail({
  state,
  alt,
  icon,
  className,
}: {
  state: ThumbnailState;
  alt: string;
  icon: ReactNode;
  className?: string;
}) {
  const box = cn(
    "flex items-center justify-center overflow-hidden rounded-md",
    className,
  );

  switch (state.status) {
    case "pending":
      return (
        <div className={cn(box, "bg-white/70 ring-1 ring-ink/10")}>
          <Loader2 className="size-4 animate-spin text-muted-foreground/70" />
        </div>
      );
    case "unavailable":
      return (
        <div
          className={cn(
            box,
            "flex-col gap-1 bg-white/70 text-muted-foreground/70 ring-1 ring-ink/10",
          )}
        >
          {icon}
          <span className="text-[10px] font-medium uppercase tracking-wide">
            No preview
          </span>
        </div>
      );
    case "ready":
      return (
        <div className={box}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={state.url}
            alt={alt}
            className="max-h-full max-w-full rounded-sm bg-white object-contain shadow-sm ring-1 ring-ink/10"
          />
        </div>
      );
  }
}
