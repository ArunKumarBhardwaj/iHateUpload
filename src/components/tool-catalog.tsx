"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";

import { ToolIcon } from "@/components/tool-icon";
import type { ToolDefinition } from "@/lib/tools";
import { cn } from "@/lib/utils";

type Group = { id: string; title: string; tools: readonly ToolDefinition[] };

/**
 * Every tool as a grid, filtered by job. "All" leads with the most used
 * tools. The jobs sit in one scrollable row of tabs, each with its count.
 * All links render on the server too, so crawlers see the whole catalog.
 * The filter lives in the URL hash (#smaller, #private…), so footer links
 * and shared links open the grid already filtered.
 */
export function ToolCatalog({
  all,
  groups,
}: {
  all: readonly ToolDefinition[];
  groups: readonly Group[];
}) {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const active = groups.some((group) => group.id === hash) ? hash : "all";
  const shown =
    active === "all"
      ? all
      : (groups.find((group) => group.id === active)?.tools ?? all);

  const chips = [
    { id: "all", title: "All tools", count: all.length },
    ...groups.map((group) => ({ ...group, count: group.tools.length })),
  ];

  return (
    <div>
      {/* Anchors so /#private scrolls here natively, from any page. */}
      {groups.map((group) => (
        <span key={group.id} id={group.id} className="block scroll-mt-28" />
      ))}
      {/* w-max + mx-auto centres the row when it fits and scrolls when not. */}
      <div className="-mx-6 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <div
          role="group"
          aria-label="Filter tools by job"
          className="mx-auto flex w-max gap-0.5 rounded-full border border-ink/8 bg-card p-1"
        >
          {chips.map((chip) => {
            const selected = active === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  window.location.hash =
                    chip.id === "all" ? "all-tools" : chip.id;
                }}
                className={cn(
                  "pressable inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full px-3 text-sm font-medium",
                  selected
                    ? "bg-ink text-white"
                    : "text-ink hover:bg-ink/[0.05]",
                )}
              >
                {chip.title}
                <span
                  className={cn(
                    "text-xs tabular-nums",
                    selected ? "text-white/65" : "text-muted-foreground",
                  )}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <ul
        key={active}
        className="mt-6 grid grid-cols-2 gap-2.5 sm:mt-8 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map((tool, index) => (
          <li
            key={tool.id}
            className="enter"
            style={{ "--i": index } as React.CSSProperties}
          >
            <Link
              href={`/tools/${tool.slug}`}
              className="group pressable lift flex h-full items-center gap-3 rounded-2xl border border-ink/8 bg-card p-3 hover:border-ink/15 hover:shadow-[0_14px_30px_-18px_rgba(20,22,28,0.35)] sm:flex-col sm:items-start sm:gap-0 sm:p-5"
            >
              <ToolIcon id={tool.id} className="size-9 sm:size-12" />
              <span className="min-w-0 sm:mt-4">
                <span className="block text-sm leading-tight font-semibold text-ink sm:text-base">
                  {tool.title}
                </span>
                <span className="mt-1.5 line-clamp-2 hidden text-sm leading-snug text-muted-foreground sm:block">
                  {tool.description}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash() {
  return window.location.hash.slice(1);
}
