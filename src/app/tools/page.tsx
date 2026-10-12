import type { Metadata } from "next";

import Link from "next/link";

import { ToolIcon } from "@/components/tool-icon";
import { TOOLS, type ToolDefinition } from "@/lib/tools";

// The homepage browses by job; this page finds a tool by its name.
const BY_LETTER = [...TOOLS]
  .sort((a, b) => a.title.localeCompare(b.title))
  .reduce<Record<string, ToolDefinition[]>>((letters, tool) => {
    const letter = tool.title[0].toUpperCase();
    (letters[letter] ??= []).push(tool);
    return letters;
  }, {});

export const metadata: Metadata = {
  title: "All PDF and Image Tools — No Upload",
  description:
    "Every iHateUpload tool in one list. Compress, crop, convert, merge, and more. Files stay in this tab.",
  alternates: { canonical: "/tools" },
  openGraph: {
    title: "All PDF and Image Tools — No Upload",
    description:
      "Every iHateUpload tool in one list. Files stay in this tab.",
    url: "/tools",
    type: "website",
  },
};

export default function ToolsIndexPage() {
  const letters = Object.keys(BY_LETTER);
  return (
    <div className="mx-auto max-w-[90rem] px-6 py-12 sm:py-16">
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          All tools, A to Z
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          {TOOLS.length} tools. Every one runs on your device.
        </p>
      </div>

      <nav
        aria-label="Jump to letter"
        className="mt-8 flex flex-wrap justify-center gap-1"
      >
        {letters.map((letter) => (
          <a
            key={letter}
            href={`#letter-${letter}`}
            className="inline-flex size-10 items-center justify-center rounded-lg text-sm font-semibold text-ink hover:bg-surface"
          >
            {letter}
          </a>
        ))}
      </nav>

      <div className="mt-10 space-y-10">
        {letters.map((letter) => (
          <section
            key={letter}
            id={`letter-${letter}`}
            aria-labelledby={`letter-${letter}-title`}
            className="scroll-mt-24 grid gap-4 border-t border-ink/8 pt-6 md:grid-cols-[4rem_minmax(0,1fr)]"
          >
            <h2
              id={`letter-${letter}-title`}
              className="text-3xl font-semibold text-ink/30"
            >
              {letter}
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {BY_LETTER[letter].map((tool) => (
                <li key={tool.id}>
                  <Link
                    href={`/tools/${tool.slug}`}
                    className="group flex items-center gap-3 rounded-xl p-2 hover:bg-surface"
                  >
                    <ToolIcon id={tool.id} className="size-10" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">
                        {tool.title}
                      </span>
                      <span className="block truncate text-sm text-muted-foreground">
                        {tool.description}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
