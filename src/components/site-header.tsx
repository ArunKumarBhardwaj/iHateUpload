"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Search } from "lucide-react";

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
    id: "images",
    label: "Images",
    href: "/#all-tools",
    tools: TOOLS.filter((tool) => tool.kind === "image"),
  },
  {
    id: "pdf",
    label: "PDF",
    href: "/#all-tools",
    tools: TOOLS.filter((tool) => tool.kind === "pdf"),
  },
];

const POPULAR_SEARCH = [
  "compress-image",
  "image-to-pdf",
  "pdf-to-jpg",
  "merge-pdf",
  "heic-to-jpg",
  "organize-pdf",
  "resize-image",
  "compress-to-size",
  "crop-image",
  "compress-pdf",
] as const;

type OpenSection = "pdf" | "images" | null;

function useFineHover() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(hover: hover) and (pointer: fine)");
    const sync = () => setEnabled(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return enabled;
}

// The border only appears once the page moves under the header.
function useScrolled() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sync = () => setScrolled(window.scrollY > 4);
    sync();
    window.addEventListener("scroll", sync, { passive: true });
    return () => window.removeEventListener("scroll", sync);
  }, []);

  return scrolled;
}

export function SiteHeader({ className }: { className?: string }) {
  const [open, setOpen] = useState<OpenSection>(null);
  const [shown, setShown] = useState<OpenSection>(null);
  const [entered, setEntered] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<number>(0);
  const fineHover = useFineHover();
  const scrolled = useScrolled();

  const cancelClose = () => {
    window.clearTimeout(closeTimer.current);
  };

  const openSection = (id: OpenSection) => {
    cancelClose();
    setOpen(id);
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(null), 180);
  };

  useEffect(() => {
    return () => window.clearTimeout(closeTimer.current);
  }, []);

  // Keep the last menu mounted while it fades out; mark it entered a frame later so it animates in.
  if (open && open !== shown) setShown(open);
  if (!open && entered) setEntered(false);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

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

  const active = SECTIONS.find((section) => section.id === (open ?? shown));

  return (
    <header
      ref={rootRef}
      className={cn(
        "sticky top-0 z-20 border-b bg-background/80 font-sans text-ink backdrop-blur-xl backdrop-saturate-150 transition-[border-color,background-color] duration-200",
        scrolled || active ? "border-ink/8" : "border-transparent",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-4 px-5 sm:px-6 md:grid md:grid-cols-[1fr_auto_1fr]">
        <Link
          href="/"
          aria-label="iHateUpload home"
          className="pressable flex shrink-0 items-baseline justify-self-start font-display text-[1.6rem] leading-none font-semibold tracking-[-0.035em]"
        >
          <span className="text-ink">iHate</span>
          <span className="text-brand">Upload</span>
        </Link>

        <nav
          className="hidden items-center gap-0.5 rounded-full bg-ink/[0.045] p-1 font-sans sm:flex"
          onMouseEnter={fineHover ? cancelClose : undefined}
          onMouseLeave={fineHover ? scheduleClose : undefined}
        >
          {SECTIONS.map((section) => (
            <NavButton
              key={section.id}
              section={section}
              open={open === section.id}
              panelId={panelId}
              onHover={() => openSection(section.id)}
              onToggle={() => openSection(section.id)}
            />
          ))}
          <Link
            href="/tools/workflow"
            className="pressable rounded-full px-3.5 py-1.5 font-sans text-[15px] font-medium text-ink/70 hover:bg-card hover:text-ink"
          >
            Workflow
          </Link>
        </nav>

        <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 md:ml-0">
          <ToolSearch onOpen={() => setOpen(null)} />
          <Link
            href="/#all-tools"
            className="pressable hidden h-10 shrink-0 items-center rounded-full bg-ink px-4 text-sm font-semibold text-white hover:bg-ink/85 lg:inline-flex"
          >
            All tools
          </Link>
        </div>
      </div>

      <nav className="flex sm:hidden">
        <div className="mx-5 mb-2.5 flex w-full gap-0.5 rounded-full bg-ink/[0.045] p-1">
          {SECTIONS.map((section) => (
            <NavButton
              key={section.id}
              section={section}
              open={open === section.id}
              panelId={panelId}
              className="flex-1 justify-center"
              onToggle={() =>
                setOpen((current) =>
                  current === section.id ? null : section.id,
                )
              }
            />
          ))}
          <Link
            href="/tools/workflow"
            className="pressable inline-flex flex-1 items-center justify-center rounded-full px-3 py-1.5 font-sans text-[15px] font-medium text-ink/70 hover:bg-card hover:text-ink"
          >
            Workflow
          </Link>
        </div>
      </nav>

      {active && (
        <div
          id={panelId}
          role="menu"
          className={cn(
            "absolute top-[calc(100%+0.5rem)] left-1/2 w-[min(64rem,calc(100vw-1.5rem))] origin-top -translate-x-1/2 rounded-[1.5rem] bg-card shadow-[0_30px_60px_-30px_rgba(17,18,20,0.35)] ring-1 ring-ink/8 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
            entered
              ? "scale-100 opacity-100"
              : "pointer-events-none scale-[0.97] opacity-0",
          )}
          onMouseEnter={
            fineHover
              ? () => {
                  cancelClose();
                  if (shown) openSection(shown);
                }
              : undefined
          }
          onMouseLeave={fineHover ? scheduleClose : undefined}
          onTransitionEnd={(event) => {
            if (event.target !== event.currentTarget) return;
            if (!open) setShown(null);
          }}
        >
          <div className="max-h-[70vh] overflow-y-auto p-3 sm:p-4">
            <div className="mb-2 flex items-baseline justify-between gap-2 px-2 pt-1">
              <p className="font-display text-xl font-semibold tracking-[-0.02em] text-ink">
                {active.label} tools
                <span className="ml-2 font-sans text-sm font-medium text-ink/40 tabular-nums">
                  {active.tools.length}
                </span>
              </p>
              <Link
                href={active.href}
                className="inline-flex items-center gap-1 font-sans text-sm font-semibold text-ink underline-offset-4 hover:underline"
                onClick={() => queueMicrotask(() => setOpen(null))}
              >
                See all
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 md:grid-cols-3 lg:grid-cols-4">
              {active.tools.map((tool) => (
                <Link
                  key={tool.id}
                  role="menuitem"
                  href={`/tools/${tool.slug}`}
                  className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors duration-150 hover:bg-ink/[0.045]"
                  onClick={() => queueMicrotask(() => setOpen(null))}
                >
                  <ToolIcon
                    id={tool.id}
                    className="size-7 rounded-md"
                    iconClassName="size-3.5"
                  />
                  <span className="truncate font-sans text-sm font-medium tracking-tight text-ink">
                    {tool.title}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function NavButton({
  section,
  open,
  panelId,
  className,
  onHover,
  onToggle,
}: {
  section: (typeof SECTIONS)[number];
  open: boolean;
  panelId: string;
  className?: string;
  onHover?: () => void;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "pressable relative inline-flex items-center gap-1 rounded-full px-3.5 py-1.5 font-sans text-[15px] font-medium",
        open
          ? "bg-card text-ink shadow-[0_1px_3px_rgba(17,18,20,0.12)]"
          : "text-ink/70 hover:bg-card hover:text-ink",
        className,
      )}
      aria-expanded={open}
      aria-controls={panelId}
      onMouseEnter={onHover}
      onClick={onToggle}
    >
      {section.label}
      <ChevronDown
        className={cn(
          "size-4 transition-transform duration-200 ease-out",
          open ? "rotate-180 text-ink/60" : "text-ink/35",
        )}
      />
    </button>
  );
}

function ToolSearch({ onOpen }: { onOpen: () => void }) {
  const router = useRouter();
  const listId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(0);
  const hint = useSyncExternalStore(
    () => () => {},
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"),
    () => "Ctrl K",
  );

  useEffect(() => {
    // Cmd/Ctrl+K or "/" focuses search, unless the user is already typing.
    const onKey = (event: KeyboardEvent) => {
      const isK =
        event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey);
      const isSlash =
        event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isK && !isSlash) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement ||
        el?.isContentEditable;
      if (typing && isSlash) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return POPULAR_SEARCH.map((id) =>
        TOOLS.find((tool) => tool.id === id),
      ).filter((tool): tool is ToolDefinition => tool !== undefined);
    }
    return TOOLS.filter((tool) => {
      const haystack = `${tool.title} ${tool.shortTitle} ${tool.description}`;
      return haystack.toLowerCase().includes(needle);
    }).slice(0, 8);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [open]);

  const go = (tool: ToolDefinition) => {
    router.push(`/tools/${tool.slug}`);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative w-full max-w-[15rem]">
      <label className="sr-only" htmlFor={`${listId}-q`}>
        Search tools
      </label>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink/35" />
      <input
        ref={inputRef}
        id={`${listId}-q`}
        type="search"
        value={query}
        autoComplete="off"
        placeholder="Search tools"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && matches[active] ? `${listId}-${matches[active].id}` : undefined
        }
        className="h-10 w-full rounded-full border border-transparent bg-ink/[0.045] pr-3 pl-9 font-sans text-sm tracking-tight text-ink outline-none transition-[background-color,border-color] duration-150 placeholder:text-ink/45 hover:bg-ink/[0.07] focus:border-ink/15 focus:bg-card md:pr-14"
        onFocus={() => {
          onOpen();
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.blur();
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (i + step + matches.length) % matches.length);
          }
          if (event.key === "Enter" && matches.length > 0) {
            event.preventDefault();
            go(matches[Math.min(active, matches.length - 1)]);
          }
        }}
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2.5 hidden -translate-y-1/2 rounded-md bg-card px-1.5 font-sans text-[11px] leading-5 text-ink/50 shadow-[0_1px_2px_rgba(17,18,20,0.1)] md:block">
        {hint}
      </kbd>
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[max(100%,18rem)] overflow-hidden rounded-[1.25rem] bg-card p-1.5 shadow-[0_30px_60px_-30px_rgba(17,18,20,0.35)] ring-1 ring-ink/8"
        >
          <li className="px-2.5 pt-1 pb-1.5 font-sans text-xs font-medium text-ink/45">
            {query.trim() ? "Matches" : "Popular"}
          </li>
          {matches.length === 0 ? (
            <li className="px-3 py-2 font-sans text-sm text-muted-foreground">
              No tools match that.
            </li>
          ) : (
            matches.map((tool, index) => (
              <li
                key={tool.id}
                id={`${listId}-${tool.id}`}
                role="option"
                aria-selected={index === active}
                className={cn("rounded-xl", index === active && "bg-ink/[0.045]")}
              >
                <Link
                  href={`/tools/${tool.slug}`}
                  className="flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 hover:bg-ink/[0.045]"
                  onClick={() => go(tool)}
                >
                  <ToolIcon
                    id={tool.id}
                    className="size-7 rounded-md"
                    iconClassName="size-3.5"
                  />
                  <span className="truncate font-sans text-sm font-medium tracking-tight text-ink">
                    {tool.title}
                  </span>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
