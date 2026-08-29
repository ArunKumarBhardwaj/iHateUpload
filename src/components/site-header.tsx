"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

import { TOOLS, type ToolDefinition, type ToolId } from "@/lib/tools";
import { cn } from "@/lib/utils";

const SHORTCUTS: ToolId[] = ["merge-pdf", "image-to-pdf", "protect-pdf"];

const MENU_GROUPS: { label: string; ids: ToolId[] }[] = [
  {
    label: "Move a file along",
    ids: ["merge-pdf", "compress-pdf", "split-pdf", "image-to-pdf", "pdf-to-jpg"],
  },
  {
    label: "Keep it private",
    ids: ["protect-pdf", "unlock-pdf", "organize-pdf", "rotate-pdf"],
  },
  {
    label: "Phone & web formats",
    ids: ["heic-to-jpg", "webp-to-jpg", "compress-image"],
  },
];

function toolsByIds(ids: ToolId[]): ToolDefinition[] {
  return ids
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is ToolDefinition => tool !== undefined);
}

export function SiteHeader({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header
      className={cn(
        "relative z-20 border-b border-ink/10 bg-card/70 backdrop-blur-md",
        className,
      )}
    >
      <div
        ref={rootRef}
        className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link href="/" className="group flex items-baseline gap-0.5">
          <span className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            iHate
          </span>
          <span className="font-display text-xl font-bold tracking-tight text-signal sm:text-2xl">
            Upload
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          {toolsByIds(SHORTCUTS).map((tool) => (
            <Link
              key={tool.id}
              href={`/tools/${tool.slug}`}
              className="hidden rounded-md px-2.5 py-1.5 text-sm font-medium text-ink/70 transition-colors hover:bg-ink/5 hover:text-ink lg:inline-flex"
            >
              {tool.shortTitle}
            </Link>
          ))}

          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-ink transition-colors hover:bg-ink/5"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
          >
            All tools
            <ChevronDown
              className={cn(
                "size-4 text-ink/50 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </div>

        <p className="hidden text-xs font-medium uppercase tracking-[0.14em] text-lagoon md:block">
          Hates uploads
        </p>

        {open && (
          <div
            id={panelId}
            role="menu"
            className="fixed left-1/2 top-16 z-30 mt-2 w-[min(96vw,48rem)] -translate-x-1/2 rounded-2xl border border-ink/15 bg-card p-5 shadow-[0_24px_60px_-28px_rgba(11,18,32,0.55)]"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-lagoon">
                Upload-free toolkit
              </p>
              <Link
                href="/#tools"
                className="text-sm font-semibold text-signal hover:underline"
                onClick={() => setOpen(false)}
              >
                Browse full list ↓
              </Link>
            </div>
            <div className="mt-4 grid gap-5 lg:grid-cols-3">
              {MENU_GROUPS.map((group) => (
                <div key={group.label} className="min-w-0">
                  <p className="mb-2 font-display text-sm font-bold text-ink">
                    {group.label}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1">
                    {toolsByIds(group.ids).map((tool) => (
                      <Link
                        key={tool.id}
                        role="menuitem"
                        href={`/tools/${tool.slug}`}
                        className="group rounded-xl border border-ink/12 bg-background/80 px-3 py-3 transition-colors hover:border-signal/40 hover:bg-signal/5"
                        onClick={() => setOpen(false)}
                      >
                        <span className="block font-display text-sm font-bold text-ink group-hover:text-signal">
                          {tool.title}
                        </span>
                        <span className="mt-1 line-clamp-2 block text-xs leading-snug text-muted-foreground">
                          {tool.description}
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
