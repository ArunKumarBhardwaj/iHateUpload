"use client";

import { useLayoutEffect, useRef } from "react";

import { cn } from "@/lib/utils";

/**
 * A segmented control in the Apple style: one white thumb glides to the
 * selected tab. With `value` null (say, while a search overrides the tabs)
 * the thumb fades out in place and comes back without sliding in from the
 * edge. Arrow keys move between tabs.
 */
export function SegmentedTabs<K extends string>({
  items,
  value,
  onChange,
  label,
  className,
}: {
  items: readonly { key: K; label: string }[];
  value: K | null;
  onChange: (key: K) => void;
  label: string;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const tabs = useRef(new Map<K, HTMLButtonElement>());
  const shownRef = useRef(false);

  useLayoutEffect(() => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    const el = value ? tabs.current.get(value) : undefined;
    if (!el) {
      thumb.style.opacity = "0";
      shownRef.current = false;
      return;
    }
    const place = () => {
      thumb.style.width = `${el.offsetWidth}px`;
      thumb.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    if (!shownRef.current) {
      thumb.style.transition = "none";
      place();
      void thumb.offsetWidth;
      thumb.style.transition = "";
      shownRef.current = true;
    } else {
      place();
    }
    thumb.style.opacity = "1";
    // Keep the chosen tab in view when the row scrolls on small screens.
    const list = listRef.current?.parentElement;
    if (list && list.scrollWidth > list.clientWidth) {
      const left = el.offsetLeft - (list.clientWidth - el.offsetWidth) / 2;
      list.scrollTo({ left, behavior: "smooth" });
    }
  }, [value]);

  const move = (from: K, step: number) => {
    const index = items.findIndex((item) => item.key === from);
    const next = items[(index + step + items.length) % items.length];
    onChange(next.key);
    tabs.current.get(next.key)?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      className={cn(
        "relative flex w-max gap-0.5 rounded-full bg-ink/[0.05] p-1",
        className,
      )}
    >
      <span
        ref={thumbRef}
        aria-hidden
        className="pointer-events-none absolute inset-y-1 left-0 rounded-full bg-card opacity-0 shadow-[0_1px_2px_rgba(17,18,20,0.1),0_3px_10px_-3px_rgba(17,18,20,0.14)] transition-[transform,width,opacity] duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-opacity"
      />
      {items.map((item) => {
        const selected = item.key === value;
        return (
          <button
            key={item.key}
            ref={(el) => {
              if (el) tabs.current.set(item.key, el);
              else tabs.current.delete(item.key);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected || (value === null && item === items[0]) ? 0 : -1}
            onClick={() => onChange(item.key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") move(item.key, 1);
              if (event.key === "ArrowLeft") move(item.key, -1);
            }}
            className={cn(
              "relative z-10 shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-200 focus-visible:outline-offset-0",
              selected ? "text-ink" : "text-ink/60 hover:text-ink",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
