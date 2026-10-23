"use client";

import { useEffect, useRef, useState } from "react";

const LETTERS = "iHateUpload".split("");

/**
 * The footer's giant wordmark: one soft tone that fades toward the page's
 * bottom edge. Letters rise in a stagger the first time it scrolls into view.
 * Transform-only, and shown at rest when motion is reduced.
 */
export function FooterWordmark() {
  const ref = useRef<HTMLDivElement>(null);
  // "rest" until the script runs, so the word shows even without it. It only
  // hides, ready to rise, while the footer is still below the screen.
  const [state, setState] = useState<"rest" | "armed" | "shown">("rest");

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    if (node.getBoundingClientRect().top < window.innerHeight) return;
    setState("armed");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setState("shown");
        observer.disconnect();
      },
      { threshold: 0.35 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      data-state={state}
      className="footer-mark mx-auto max-w-[90rem] overflow-hidden px-6 select-none"
    >
      <p className="font-display flex pt-[0.06em] text-[max(3rem,calc((min(100vw,90rem)-4rem)/5.4))] leading-[0.8] font-semibold tracking-[-0.055em] whitespace-nowrap">
        {LETTERS.map((ch, i) => (
          <span
            key={i}
            className="footer-letter -mx-[0.1em] inline-block px-[0.1em] pb-[0.28em]"
            style={{ "--c": i } as React.CSSProperties}
          >
            {ch}
          </span>
        ))}
      </p>
    </div>
  );
}

