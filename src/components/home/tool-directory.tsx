"use client";

import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";
import { ArrowRight, Search, X } from "lucide-react";

import { ToolIcon } from "@/components/tool-icon";
import { SegmentedTabs } from "@/components/ui/segmented-tabs";
import type { ToolDefinition, ToolId } from "@/lib/tools";
import { cn } from "@/lib/utils";

type Group = { id: string; title: string; tools: ToolDefinition[] };

const POPULAR: ToolId[] = [
  "compress-pdf",
  "merge-pdf",
  "word-to-pdf",
  "pdf-to-word",
  "image-to-pdf",
  "pdf-to-jpg",
  "edit-pdf",
  "sign-pdf",
  "compress-image",
  "heic-to-jpg",
  "split-pdf",
  "protect-pdf",
];

/**
 * Every tool, one job at a time: segmented tabs pick the job, a card grid
 * shows its tools, and the filter searches all of them at once. Every panel
 * is in the HTML (inactive ones `hidden`), so crawlers still see each link.
 * The job also lives in the URL hash, so footer links like /#private open
 * the right tab; picking a tab here doesn't touch the URL.
 */
export function ToolDirectory({ groups }: { groups: Group[] }) {
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  // A pick only counts until the hash changes, so a footer link still wins.
  const [picked, setPicked] = useState<{ key: string; hash: string } | null>(
    null,
  );
  const [query, setQuery] = useState("");

  const all = useMemo(() => groups.flatMap((group) => group.tools), [groups]);
  const panels = useMemo(
    () => [
      {
        id: "popular",
        title: "Popular",
        tools: POPULAR.map((id) => all.find((tool) => tool.id === id)).filter(
          (tool): tool is ToolDefinition => tool !== undefined,
        ),
      },
      ...groups,
    ],
    [all, groups],
  );

  const fromHash = panels.some((panel) => panel.id === hash) ? hash : "popular";
  const active = picked && picked.hash === hash ? picked.key : fromHash;

  const needle = query.trim().toLowerCase();
  const matches = needle
    ? all.filter((tool) =>
        `${tool.title} ${tool.shortTitle} ${tool.description}`
          .toLowerCase()
          .includes(needle),
      )
    : [];

  return (
    <div>
      {/* Anchors so /#smaller, /#private… scroll here from any page. */}
      {groups.map((group) => (
        <span key={group.id} id={group.id} className="block scroll-mt-28" />
      ))}

      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <h2 className="font-display text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
          Every tool, by job
        </h2>
        <div className="relative w-full sm:w-72">
          <label htmlFor="tool-filter" className="sr-only">
            Filter all {all.length} tools
          </label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink/40"
            aria-hidden
          />
          <input
            id="tool-filter"
            type="search"
            value={query}
            autoComplete="off"
            placeholder={`Filter all ${all.length} tools`}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setQuery("");
            }}
            className="h-11 w-full rounded-full border border-transparent bg-ink/[0.05] pr-10 pl-10 text-sm text-ink outline-none transition-[background-color,border-color] duration-150 placeholder:text-ink/45 hover:bg-ink/[0.07] focus:border-ink/15 focus:bg-card [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear filter"
              onClick={() => setQuery("")}
              className="pressable absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-ink/50 hover:bg-ink/[0.06] hover:text-ink"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      </div>

      <div className="-mx-5 mt-8 overflow-x-auto px-5 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        <SegmentedTabs
          label="Tools by job"
          items={panels.map((panel) => ({ key: panel.id, label: panel.title }))}
          value={needle ? null : active}
          onChange={(key) => {
            setQuery("");
            setPicked({ key, hash });
          }}
        />
      </div>

      <div className="mt-6 min-h-[13rem]">
        {panels.map((panel) => (
          <ToolGrid
            key={panel.id}
            tools={panel.tools}
            hidden={Boolean(needle) || panel.id !== active}
          />
        ))}
        {needle ? (
          matches.length > 0 ? (
            <ToolGrid key={`q-${needle}`} tools={matches} hidden={false} />
          ) : (
            <p className="rounded-[1.25rem] bg-card px-6 py-10 text-center text-sm text-ink/60 ring-1 ring-ink/6">
              No tool matches “{query.trim()}”. Try a format like PDF, JPG or
              Word.
            </p>
          )
        ) : null}
      </div>

      <Link
        href="/tools/workflow"
        className="pressable mt-8 inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline"
      >
        Several steps on many files? Chain them into a workflow
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </div>
  );
}

function ToolGrid({
  tools,
  hidden,
}: {
  tools: readonly ToolDefinition[];
  hidden: boolean;
}) {
  return (
    <ul
      hidden={hidden}
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
    >
      {tools.map((tool, index) => (
        <li
          key={tool.id}
          className="enter"
          style={{ "--i": index } as React.CSSProperties}
        >
          <Link
            href={`/tools/${tool.slug}`}
            className="group pressable lift flex h-full items-start gap-3.5 rounded-[1.25rem] bg-card p-4 ring-1 ring-ink/6 hover:shadow-[0_18px_40px_-26px_rgba(17,18,20,0.35)]"
          >
            <ToolIcon id={tool.id} className="size-10" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 text-[15px] leading-tight font-semibold text-ink">
                {tool.title}
                <ArrowRight
                  className={cn(
                    "size-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] duration-200 ease-out",
                    "group-hover:translate-x-0 group-hover:opacity-50",
                  )}
                  aria-hidden
                />
              </span>
              <span className="mt-1 line-clamp-2 text-sm leading-snug text-ink/60">
                {tool.description}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readHash() {
  return window.location.hash.slice(1);
}
