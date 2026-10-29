"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { Check, GripVertical, Loader2 } from "lucide-react";

import type { PdfSession, ShownPage } from "@/lib/use-pdf-session";
import { cn } from "@/lib/utils";

/**
 * A grid of PDF page thumbnails. Pages render lazily as they scroll into view,
 * turns are applied with CSS so they are instant, and the grid supports
 * multi-select, keyboard navigation and drag reordering (mouse, touch handle,
 * and Alt+Arrow keys).
 */
export type GridPage = {
  /** Unique within the grid. */
  key: string;
  /** Zero-based source page, or -1 for a blank page. */
  page: number;
  /** Clockwise turn drawn on top of the page. */
  turn: number;
  label?: string;
};

type Props = {
  session: PdfSession | null;
  sizes: ShownPage[] | null;
  pages: GridPage[];
  selected: ReadonlySet<string>;
  onSelected: (next: Set<string>) => void;
  selectMode?: "multi" | "single";
  /** Enables dragging. `insertBefore` indexes the current order. */
  onReorder?: (keys: string[], insertBefore: number) => void;
  renderActions?: (page: GridPage, index: number) => ReactNode;
  disabled?: boolean;
  ariaLabel: string;
  /** Size of a blank page, in points. */
  blankSize?: ShownPage;
  /** Hide the selection tick, for grids that only pick one page to look at. */
  quietSelection?: boolean;
};

const MAX_W = 8.2;
const MAX_H = 10.4;

function fitRem(w: number, h: number) {
  const k = Math.min(MAX_W / w, MAX_H / h);
  return { w: w * k, h: h * k };
}

/** One page thumbnail, sized to the page's shape. Renders once `visible`. */
export function PageThumb({
  session,
  page,
  turn,
  visible,
  size,
  alt,
  scale = 1,
}: {
  session: PdfSession | null;
  page: number;
  turn: number;
  visible: boolean;
  size: ShownPage;
  alt: string;
  /** Shrinks the box below the grid's size, for compact previews. */
  scale?: number;
}) {
  const [loaded, setLoaded] = useState<{ session: PdfSession; page: number; url: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible || !session || page < 0) return;
    let live = true;
    session.thumb(page).then(
      (url) => live && setLoaded({ session, page, url }),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [visible, session, page]);

  const url = loaded && loaded.session === session && loaded.page === page ? loaded.url : null;
  const quarter = turn % 180 !== 0;
  const shownW = quarter ? size.height : size.width;
  const shownH = quarter ? size.width : size.height;
  const fit = fitRem(shownW, shownH);
  const box = { w: fit.w * scale, h: fit.h * scale };
  return (
    <div
      className="relative overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-ink/15"
      style={{
        width: `${box.w}rem`,
        height: `${box.h}rem`,
        containerType: "size",
      }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={alt}
          draggable={false}
          className="pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none transition-transform duration-200"
          style={{
            width: quarter ? "100cqh" : "100cqw",
            height: quarter ? "100cqw" : "100cqh",
            transform: `translate(-50%, -50%) rotate(${turn}deg)`,
          }}
        />
      ) : page < 0 ? (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-wide text-muted-foreground/70">
          Blank
        </span>
      ) : (
        <span
          role="img"
          aria-label={failed ? `${alt}, preview unavailable` : alt}
          className="absolute inset-0 flex items-center justify-center text-muted-foreground/60"
        >
          {failed ? (
            <span className="text-[10px] uppercase tracking-wide">No preview</span>
          ) : (
            <Loader2 className="size-4 animate-spin" />
          )}
        </span>
      )}
    </div>
  );
}

export function PageGrid({
  session,
  sizes,
  pages,
  selected,
  onSelected,
  selectMode = "multi",
  onReorder,
  renderActions,
  disabled = false,
  ariaLabel,
  blankSize = { width: 595, height: 842 },
  quietSelection = false,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null);
  const anchor = useRef<string | null>(null);
  const suppressClick = useRef(false);
  const pendingFocus = useRef<string | null>(null);
  const [visible, setVisible] = useState<ReadonlySet<number>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [drag, setDrag] = useState<{
    keys: string[];
    x: number;
    y: number;
    before: number | null;
  } | null>(null);

  // Lazy thumbnails: a page renders once it is within a screen of the viewport.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof IntersectionObserver === "undefined") {
      setVisible(new Set(pages.map((_, i) => i)));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            if (entry.isIntersecting) {
              next.add(Number((entry.target as HTMLElement).dataset.gridIndex));
            }
          }
          return next.size === prev.size ? prev : next;
        });
      },
      { rootMargin: "400px 0px" },
    );
    list.querySelectorAll("[data-grid-index]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pages]);

  const index = useCallback(
    (key: string) => pages.findIndex((p) => p.key === key),
    [pages],
  );

  const effectiveFocus =
    focusKey && pages.some((p) => p.key === focusKey)
      ? focusKey
      : (pages[0]?.key ?? null);

  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-key="${CSS.escape(pendingFocus.current)}"]`,
    );
    pendingFocus.current = null;
    el?.focus();
  });

  const columns = () => {
    const items = listRef.current?.querySelectorAll<HTMLElement>("[data-grid-index]");
    if (!items || items.length === 0) return 1;
    const top = items[0].offsetTop;
    let n = 0;
    for (const el of items) {
      if (el.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  };

  const toggle = (key: string, shift: boolean) => {
    if (disabled) return;
    if (selectMode === "single") {
      onSelected(new Set([key]));
      anchor.current = key;
      return;
    }
    const next = new Set(selected);
    if (shift && anchor.current) {
      const a = index(anchor.current);
      const b = index(key);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) next.add(pages[i].key);
    } else {
      if (next.has(key)) next.delete(key);
      else next.add(key);
      anchor.current = key;
    }
    onSelected(next);
  };

  const moveBy = (key: string, delta: -1 | 1) => {
    if (!onReorder || disabled) return;
    const keys = selected.has(key) ? pages.filter((p) => selected.has(p.key)).map((p) => p.key) : [key];
    const idxs = keys.map(index);
    const before = delta < 0 ? Math.max(0, Math.min(...idxs) - 1) : Math.min(pages.length, Math.max(...idxs) + 2);
    onReorder(keys, before);
    pendingFocus.current = key;
  };

  const onKeyDown = (event: ReactKeyboardEvent, key: string) => {
    if (disabled) return;
    const i = index(key);
    const go = (to: number, extend: boolean) => {
      const clamped = Math.max(0, Math.min(pages.length - 1, to));
      const target = pages[clamped];
      if (!target) return;
      event.preventDefault();
      if (extend && selectMode === "multi") {
        anchor.current ??= key;
        const a = index(anchor.current);
        const [lo, hi] = a < clamped ? [a, clamped] : [clamped, a];
        onSelected(new Set(pages.slice(lo, hi + 1).map((p) => p.key)));
      }
      setFocusKey(target.key);
      pendingFocus.current = target.key;
      // A state change may not re-render; focus directly as well.
      listRef.current
        ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(target.key)}"]`)
        ?.focus();
    };
    if ((event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowUp")) && onReorder) {
      event.preventDefault();
      moveBy(key, -1);
    } else if (event.altKey && (event.key === "ArrowRight" || event.key === "ArrowDown") && onReorder) {
      event.preventDefault();
      moveBy(key, 1);
    } else if (event.key === "ArrowLeft") go(i - 1, event.shiftKey);
    else if (event.key === "ArrowRight") go(i + 1, event.shiftKey);
    else if (event.key === "ArrowUp") go(i - columns(), event.shiftKey);
    else if (event.key === "ArrowDown") go(i + columns(), event.shiftKey);
    else if (event.key === "Home") go(0, event.shiftKey);
    else if (event.key === "End") go(pages.length - 1, event.shiftKey);
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a" && selectMode === "multi") {
      event.preventDefault();
      onSelected(new Set(pages.map((p) => p.key)));
    } else if (event.key === "Escape" && selected.size > 0) {
      onSelected(new Set());
    }
  };

  const startDrag = (event: ReactPointerEvent, key: string, fromHandle: boolean) => {
    if (disabled || !onReorder || event.button !== 0) return;
    if (event.pointerType === "touch" && !fromHandle) return;
    const keys = selected.has(key)
      ? pages.filter((p) => selected.has(p.key)).map((p) => p.key)
      : [key];
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let before: number | null = null;
    let raf = 0;
    let lastY = startY;

    const autoScroll = () => {
      const edge = 70;
      if (lastY < edge) window.scrollBy(0, -14);
      else if (lastY > window.innerHeight - edge) window.scrollBy(0, 14);
      raf = requestAnimationFrame(autoScroll);
    };

    const move = (e: PointerEvent) => {
      if (!active) {
        if (Math.hypot(e.clientX - startX, e.clientY - startY) < 6) return;
        active = true;
        raf = requestAnimationFrame(autoScroll);
      }
      lastY = e.clientY;
      const hit = document
        .elementFromPoint(e.clientX, e.clientY)
        ?.closest<HTMLElement>("[data-grid-index]");
      if (hit && listRef.current?.contains(hit)) {
        const r = hit.getBoundingClientRect();
        before = Number(hit.dataset.gridIndex) + (e.clientX > r.left + r.width / 2 ? 1 : 0);
      }
      setDrag({ keys, x: e.clientX, y: e.clientY, before });
    };
    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      cancelAnimationFrame(raf);
      if (active) {
        suppressClick.current = true;
        setTimeout(() => (suppressClick.current = false), 0);
        setDrag(null);
        if (commit && before !== null) onReorder(keys, before);
      }
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  const dragging = new Set(drag?.keys ?? []);
  const dragPage = drag ? pages.find((p) => p.key === drag.keys[0]) : undefined;

  return (
    <>
      <ul
        ref={listRef}
        aria-label={ariaLabel}
        className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-3 gap-y-5"
      >
        {pages.map((p, i) => {
          const size = p.page >= 0 ? (sizes?.[p.page] ?? blankSize) : blankSize;
          const isSelected = selected.has(p.key);
          const label = p.label ?? String(i + 1);
          const dropHere = drag && drag.before === i;
          const dropAfterLast = drag && drag.before === pages.length && i === pages.length - 1;
          return (
            <li
              key={p.key}
              data-grid-index={i}
              className={cn(
                "group/card relative flex flex-col items-center gap-1.5 rounded-lg",
                dragging.has(p.key) && "opacity-40",
              )}
            >
              {dropHere ? (
                <span aria-hidden className="absolute -left-2 bottom-6 top-0 w-1 rounded-full bg-signal" />
              ) : null}
              {dropAfterLast ? (
                <span aria-hidden className="absolute -right-2 bottom-6 top-0 w-1 rounded-full bg-signal" />
              ) : null}
              <div
                className="relative flex h-[11rem] w-full items-center justify-center"
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("[data-handle]")) return;
                  startDrag(e, p.key, false);
                }}
              >
                <button
                  type="button"
                  data-key={p.key}
                  aria-pressed={isSelected}
                  aria-label={`Page ${label}${p.page < 0 ? ", blank" : ""}${p.turn ? `, turned ${p.turn} degrees` : ""}${isSelected ? ", selected" : ""}`}
                  tabIndex={p.key === effectiveFocus ? 0 : -1}
                  disabled={disabled}
                  className={cn(
                    "relative rounded-md p-1 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-signal",
                    isSelected && "ring-2 ring-signal",
                    onReorder && !disabled && "cursor-grab active:cursor-grabbing",
                  )}
                  onFocus={() => setFocusKey(p.key)}
                  onClick={(e) => {
                    if (suppressClick.current) return;
                    toggle(p.key, e.shiftKey);
                  }}
                  onKeyDown={(e) => onKeyDown(e, p.key)}
                >
                  <PageThumb
                    session={session}
                    page={p.page}
                    turn={p.turn}
                    visible={visible.has(i)}
                    size={size}
                    alt={`Page ${label}`}
                  />
                  {isSelected && !quietSelection ? (
                    <span className="absolute right-0 top-0 flex size-5 items-center justify-center rounded-full bg-signal text-white shadow">
                      <Check className="size-3" />
                    </span>
                  ) : null}
                </button>
                {onReorder && !disabled ? (
                  <span
                    data-handle
                    aria-hidden
                    title="Drag to move"
                    className="absolute left-0 top-0 flex size-8 touch-none cursor-grab items-center justify-center rounded-md bg-card/90 text-muted-foreground shadow-sm sm:size-6"
                    onPointerDown={(e) => startDrag(e, p.key, true)}
                  >
                    <GripVertical className="size-4" />
                  </span>
                ) : null}
              </div>
              <p className="text-xs font-medium text-muted-foreground">{label}</p>
              {renderActions ? (
                <div className="flex flex-wrap items-center justify-center gap-1">
                  {renderActions(p, i)}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {drag && dragPage ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-50 rounded-md bg-signal px-2 py-1 text-xs font-semibold text-white shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 12 }}
        >
          {drag.keys.length > 1 ? `${drag.keys.length} pages` : `Page ${dragPage.label ?? index(dragPage.key) + 1}`}
        </div>
      ) : null}
    </>
  );
}
