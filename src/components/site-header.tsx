import Link from "next/link";

import { TOOLS } from "@/lib/tools";
import { cn } from "@/lib/utils";

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "relative z-20 border-b border-ink/10 bg-card/70 backdrop-blur-md",
        className,
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex items-baseline gap-0.5">
          <span className="font-display text-xl font-bold tracking-tight text-ink sm:text-2xl">
            iHate
          </span>
          <span className="font-display text-xl font-bold tracking-tight text-signal sm:text-2xl">
            Upload
          </span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex">
          {TOOLS.filter((tool) => tool.showInNav).map((tool) => (
            <Link
              key={tool.id}
              href={`/tools/${tool.slug}`}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-ink/70 transition-colors hover:bg-ink/5 hover:text-ink"
            >
              {tool.shortTitle}
            </Link>
          ))}
        </nav>
        <p className="hidden text-xs font-medium uppercase tracking-[0.14em] text-lagoon sm:block">
          Never leaves device
        </p>
      </div>
    </header>
  );
}
