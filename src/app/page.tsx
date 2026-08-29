import Link from "next/link";
import { ArrowRight, Lock, ShieldOff, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TOOLS } from "@/lib/tools";

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-signal/20 blur-3xl" />
          <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-lagoon/20 blur-3xl" />
        </div>

        <div className="relative mx-auto flex min-h-[78vh] max-w-6xl flex-col justify-center px-4 py-16 sm:px-6 sm:py-24">
          <p className="animate-rise font-display text-5xl font-bold leading-[1.05] tracking-tight text-ink sm:text-7xl md:text-8xl">
            iHate
            <span className="text-signal">Upload</span>
          </p>
          <h1 className="animate-rise-delay mt-5 max-w-2xl font-display text-2xl font-semibold leading-tight text-ink/90 sm:text-3xl md:text-4xl">
            Free file tools that refuse to touch your cloud.
          </h1>
          <p className="animate-rise-delay-2 mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Merge and compress PDFs, convert HEIC or WebP, and build image PDFs
            in the browser. Your files never leave this device.
          </p>
          <div className="animate-rise-delay-2 mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg" className="h-11 px-5 text-base">
              <Link href="/tools/merge-pdf">
                Start with Merge PDF
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="h-11 px-5 text-base">
              <Link href="#tools">Browse tools</Link>
            </Button>
          </div>
        </div>
      </section>

      <section id="tools" className="border-t border-ink/10 bg-card/40 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {TOOLS.length} tools. Zero uploads.
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            Each tool runs locally with browser APIs. No account. No watermark.
            No daily cap.
          </p>
          <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((tool, index) => (
              <Link
                key={tool.id}
                href={`/tools/${tool.slug}`}
                className="group block border-t-2 border-ink/15 pt-5 transition-colors hover:border-signal"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
                  Tool {String(index + 1).padStart(2, "0")}
                </p>
                <h3 className="mt-2 font-display text-2xl font-bold text-ink group-hover:text-signal">
                  {tool.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {tool.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink">
                  Open tool
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:grid-cols-3 sm:px-6">
          <div>
            <ShieldOff className="size-6 text-signal" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              No upload servers
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Processing happens in your tab. Disconnect from wifi after the page
              loads and it still works.
            </p>
          </div>
          <div>
            <Lock className="size-6 text-lagoon" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              Safe for real documents
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Resumes, IDs, and family photos stay on the machine that opened
              them.
            </p>
          </div>
          <div>
            <Zap className="size-6 text-signal" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              Free forever basics
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              No signup wall. No watermark tax. Built for the search terms people
              already type every day.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
