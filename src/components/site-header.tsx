"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Lock } from "lucide-react";

import { ToolIcon } from "@/components/tool-icon";
import { TOOLS, type ToolDefinition } from "@/lib/tools";
import { cn } from "@/lib/utils";

const SECTIONS: {
  id: "pdf" | "images";
  label: string;
  href: string;
  tools: ToolDefinition[];
}[] = [
  {
    id: "pdf",
    label: "PDF",
    href: "/#pdf-tools",
    tools: TOOLS.filter((tool) => tool.kind === "pdf"),
  },
  {
    id: "images",
    label: "Images",
    href: "/#image-tools",
    tools: TOOLS.filter((tool) => tool.kind === "image"),
  },
];

type OpenSection = "pdf" | "images" | null;

export function SiteHeader({ className }: { className?: string }) {
  const [open, setOpen] = useState<OpenSection>(null);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = SECTIONS.find((section) => section.id === open);

  return (
    <header
      className={cn(
        "sticky top-0 z-20 border-b border-ink/8 bg-card/90 backdrop-blur-md",
        className,
      )}
    >
      <div
        ref={rootRef}
        className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
      >
        <Link href="/" className="flex items-baseline gap-0.5">
          <span className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            iHate
          </span>
          <span className="font-display text-xl font-bold tracking-tight text-signal sm:text-2xl">
            Upload
          </span>
        </Link>

        <nav className="flex items-center gap-1">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors hover:bg-ink/5",
                open === section.id ? "bg-ink/5 text-ink" : "text-ink/70",
              )}
              aria-expanded={open === section.id}
              aria-controls={panelId}
              onClick={() =>
                setOpen((current) =>
                  current === section.id ? null : section.id,
                )
              }
            >
              {section.label}
              <ChevronDown
                className={cn(
                  "size-4 text-ink/40 transition-transform",
                  open === section.id && "rotate-180",
                )}
              />
            </button>
          ))}
        </nav>

        <p className="hidden items-center gap-1.5 text-xs font-semibold text-lagoon md:inline-flex">
          <Lock className="size-3.5" />
          No upload
        </p>

        {active && (
          <div
            id={panelId}
            role="menu"
            className="absolute left-1/2 top-full z-30 mt-2 w-[min(96vw,44rem)] -translate-x-1/2 rounded-2xl border border-ink/10 bg-card p-4 shadow-[0_24px_60px_-28px_rgba(17,19,24,0.35)]"
          >
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <p className="text-sm font-semibold text-ink">
                {active.label} tools
              </p>
              <Link
                href={active.href}
                className="text-sm font-semibold text-signal hover:underline"
                onClick={() => setOpen(null)}
              >
                See all
              </Link>
            </div>
            <div className="grid gap-1 sm:grid-cols-2">
              {active.tools.map((tool) => (
                <Link
                  key={tool.id}
                  role="menuitem"
                  href={`/tools/${tool.slug}`}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-signal/5"
                  onClick={() => setOpen(null)}
                >
                  <ToolIcon
                    id={tool.id}
                    className="size-8 rounded-lg"
                    iconClassName="size-4"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink">
                      {tool.title}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {tool.shortTitle}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
