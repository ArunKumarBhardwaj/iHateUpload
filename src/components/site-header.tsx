"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

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

        <nav className="flex items-center gap-1 sm:gap-2">
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-ink/5",
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
                  "size-4 text-ink/50 transition-transform",
                  open === section.id && "rotate-180",
                )}
              />
            </button>
          ))}
        </nav>

        <p className="hidden text-xs font-medium uppercase tracking-[0.14em] text-lagoon md:block">
          Hates uploads
        </p>

        {active && (
          <div
            id={panelId}
            role="menu"
            className="fixed left-1/2 top-16 z-30 mt-2 w-[min(96vw,40rem)] -translate-x-1/2 rounded-2xl border border-ink/15 bg-card p-5 shadow-[0_24px_60px_-28px_rgba(11,18,32,0.55)]"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-lg font-bold text-ink">
                {active.label} tools
              </p>
              <Link
                href={active.href}
                className="text-sm font-semibold text-signal hover:underline"
                onClick={() => setOpen(null)}
              >
                See all {active.label.toLowerCase()} ↓
              </Link>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {active.tools.map((tool) => (
                <Link
                  key={tool.id}
                  role="menuitem"
                  href={`/tools/${tool.slug}`}
                  className="group rounded-xl border border-ink/12 bg-background/80 px-3 py-3 transition-colors hover:border-signal/40 hover:bg-signal/5"
                  onClick={() => setOpen(null)}
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
        )}
      </div>
    </header>
  );
}
