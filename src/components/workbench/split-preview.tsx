"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PageGrid, PageThumb, type GridPage } from "@/components/page-grid";
import { Button } from "@/components/ui/button";
import { isPageNumberMode, planSplitGroups } from "@/lib/split-groups";
import {
  formatPageList,
  parsePageRange,
  type ToolOptions,
} from "@/lib/tool-options";
import { usePdfSession, type PdfSession, type ShownPage } from "@/lib/use-pdf-session";
import { cn } from "@/lib/utils";

type SplitOptions = Extract<ToolOptions, { kind: "split" }>;

/** Range cards drawn at once; a 1,000-page "every page" split shows the first ones. */
const MAX_CARDS = 120;

const A4: ShownPage = { width: 595, height: 842 };

function Loading() {
  return (
    <p className="rounded-xl border border-ink/10 bg-secondary p-6 text-center text-sm text-muted-foreground">
      Reading the pages…
    </p>
  );
}

/** True once the element has come within a screen of the viewport. */
function useNearView<T extends Element>() {
  const ref = useRef<T>(null);
  // Without IntersectionObserver every card counts as near.
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true);
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);
  return [ref, near] as const;
}

/** One output file: first and last page with a gap between, as iLovePDF draws a range. */
function RangeCard({
  title,
  pages,
  session,
  sizes,
}: {
  title: string;
  pages: number[];
  session: PdfSession | null;
  sizes: ShownPage[] | null;
}) {
  const [ref, near] = useNearView<HTMLLIElement>();
  const contiguous = pages.every((p, i) => i === 0 || p === pages[i - 1] + 1);
  const shown =
    pages.length <= 2 || !contiguous
      ? pages.slice(0, contiguous ? 2 : 3)
      : [pages[0], pages[pages.length - 1]];
  const hidden = pages.length - shown.length;
  const label = formatPageList(pages);
  return (
    <li ref={ref} className="space-y-1.5">
      <p className="truncate text-center text-xs font-medium text-ink" title={title}>
        {title}
      </p>
      <div className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-signal/40 bg-card p-3">
        {shown.map((page, i) => (
          <div key={`${page}-${i}`} className="flex items-center gap-2">
            {i === 1 && hidden > 0 && contiguous ? (
              <span aria-hidden className="text-sm font-semibold text-muted-foreground">
                …
              </span>
            ) : null}
            <figure className="flex flex-col items-center gap-1">
              <div className="flex h-[7.5rem] items-center">
                <PageThumb
                  session={session}
                  page={page}
                  turn={0}
                  visible={near}
                  size={sizes?.[page] ?? A4}
                  alt={`Page ${page + 1}`}
                  scale={0.7}
                />
              </div>
              <figcaption className="text-[11px] tabular-nums text-muted-foreground">
                {page + 1}
              </figcaption>
            </figure>
          </div>
        ))}
        {hidden > 0 && !contiguous ? (
          <span className="text-xs text-muted-foreground">+{hidden}</span>
        ) : null}
      </div>
      <p className="text-center text-[11px] tabular-nums text-muted-foreground">
        {pages.length === 1 ? `Page ${label}` : `Pages ${label}`}
      </p>
    </li>
  );
}

/**
 * Every page as a thumbnail you click to pick, kept in step with a page text
 * like `2, 5-7`. Used by Split → Select pages and by Extract Pages.
 */
export function PagePicker({
  file,
  pageCount,
  value,
  onChange,
  disabled,
}: {
  file: File;
  pageCount: number;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  const { session, pages: sizes, failed } = usePdfSession(file);
  const picked = useMemo(() => parsePageRange(value, pageCount), [value, pageCount]);
  const selected = useMemo(() => new Set(picked.map((i) => `p${i}`)), [picked]);
  const gridPages: GridPage[] = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => ({ key: `p${i}`, page: i, turn: 0 })),
    [pageCount],
  );

  if (failed) {
    return <p className="text-sm text-destructive">Could not read the pages of this PDF.</p>;
  }
  if (pageCount === 0) return <Loading />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm font-medium text-ink" aria-live="polite">
          {picked.length === 0
            ? "Click the pages you want"
            : `${picked.length} of ${pageCount} page${pageCount === 1 ? "" : "s"} selected`}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 sm:h-7"
          disabled={disabled || picked.length === pageCount}
          onClick={() => onChange(`1-${pageCount}`)}
        >
          Select all
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-10 sm:h-7"
          disabled={disabled || picked.length === 0}
          onClick={() => onChange("")}
        >
          Clear
        </Button>
      </div>
      <div className="max-h-[38rem] overflow-y-auto rounded-xl border border-ink/10 bg-secondary p-3">
        <PageGrid
          session={session}
          sizes={sizes}
          pages={gridPages}
          selected={selected}
          onSelected={(next) =>
            onChange(formatPageList([...next].map((key) => Number(key.slice(1)))))
          }
          disabled={disabled}
          ariaLabel="Pages to pick"
        />
      </div>
    </div>
  );
}

/** The left pane of Split PDF: the files a split makes, or the pages to pick. */
export function SplitPreview({
  options,
  onOptions,
  file,
  pageCount,
  baseName,
  disabled,
}: {
  options: SplitOptions;
  onOptions: (next: ToolOptions) => void;
  file: File;
  pageCount: number;
  baseName: string;
  disabled: boolean;
}) {
  const { session, pages: sizes, failed } = usePdfSession(
    options.mode === "select" ? undefined : file,
  );

  if (options.mode === "select") {
    return (
      <PagePicker
        file={file}
        pageCount={pageCount}
        value={options.pick ?? ""}
        onChange={(pick) => onOptions({ ...options, pick })}
        disabled={disabled}
      />
    );
  }
  if (failed) {
    return <p className="text-sm text-destructive">Could not read the pages of this PDF.</p>;
  }
  if (pageCount === 0) return <Loading />;

  if (!isPageNumberMode(options.mode)) {
    // Size and Smart cuts depend on the content; their list sits in the
    // settings. Here the pages are shown for reference.
    return (
      <div className="max-h-[38rem] overflow-y-auto rounded-xl border border-ink/10 bg-secondary p-3">
        <PageGrid
          session={session}
          sizes={sizes}
          pages={Array.from({ length: pageCount }, (_, i) => ({ key: `p${i}`, page: i, turn: 0 }))}
          selected={new Set()}
          onSelected={() => {}}
          quietSelection
          ariaLabel="Pages in this PDF"
        />
      </div>
    );
  }

  const plan = planSplitGroups(options, pageCount, baseName);
  if (!plan.ok) {
    return (
      <p className="rounded-xl border border-dashed border-ink/15 bg-secondary p-6 text-center text-sm text-muted-foreground">
        {plan.error}
      </p>
    );
  }
  const cards = plan.groups.slice(0, MAX_CARDS);
  const more = plan.groups.length - cards.length;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink" aria-live="polite">
        {plan.groups.length === 1 ? "1 file" : `${plan.groups.length} files`} from {pageCount}{" "}
        page{pageCount === 1 ? "" : "s"}
        {plan.merged ? " — every range in one PDF" : ""}
      </p>
      <ol
        className={cn(
          "grid max-h-[38rem] grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-x-4 gap-y-5 overflow-y-auto rounded-xl border border-ink/10 bg-secondary p-4",
        )}
      >
        {cards.map((group, i) => (
          <RangeCard
            key={`${group.name}-${i}`}
            title={
              plan.merged
                ? group.name
                : options.mode === "ranges"
                  ? `Range ${i + 1}`
                  : `File ${i + 1}`
            }
            pages={group.pages}
            session={session}
            sizes={sizes}
          />
        ))}
      </ol>
      {more > 0 ? (
        <p className="text-xs text-muted-foreground">
          And {more} more file{more === 1 ? "" : "s"}, listed after the split.
        </p>
      ) : null}
    </div>
  );
}
