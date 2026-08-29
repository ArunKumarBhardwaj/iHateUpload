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
            Merge, compress, protect, and organize PDFs, convert HEIC or WebP,
            and build image PDFs with zero cloud hops. Cut wifi mid-job and it
            still finishes.
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

      <section id="tools" className="border-t border-ink/10 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {TOOLS.length} tools. Zero cloud hops.
          </h2>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            One tab for the jobs that usually force you across five upload sites.
            No account. No watermark. No daily cap.
          </p>
          <div className="mt-12 space-y-14">
            {(
              [
                {
                  label: "Move a file along",
                  ids: [
                    "merge-pdf",
                    "compress-pdf",
                    "split-pdf",
                    "image-to-pdf",
                    "pdf-to-jpg",
                  ],
                },
                {
                  label: "Keep it private",
                  ids: [
                    "protect-pdf",
                    "unlock-pdf",
                    "organize-pdf",
                    "rotate-pdf",
                  ],
                },
                {
                  label: "Phone & web formats",
                  ids: ["heic-to-jpg", "webp-to-jpg", "compress-image"],
                },
              ] as const
            ).map((group) => (
              <div key={group.label}>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
                  {group.label}
                </p>
                <div className="mt-4 divide-y divide-ink/10 border-y border-ink/10">
                  {group.ids.map((id) => {
                    const tool = TOOLS.find((entry) => entry.id === id);
                    if (!tool) return null;
                    return (
                      <Link
                        key={tool.id}
                        href={`/tools/${tool.slug}`}
                        className="group flex flex-col gap-1 py-5 transition-colors sm:flex-row sm:items-baseline sm:justify-between sm:gap-8"
                      >
                        <h3 className="font-display text-xl font-bold text-ink group-hover:text-signal sm:text-2xl">
                          {tool.title}
                        </h3>
                        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-right">
                          {tool.description}
                        </p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 sm:grid-cols-3 sm:px-6">
          <div>
            <ShieldOff className="size-6 text-signal" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              Zero cloud hops
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your file never takes a trip to our servers, because we do not have
              one for it. Load the page, kill wifi, keep working.
            </p>
          </div>
          <div>
            <Lock className="size-6 text-lagoon" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              Built for awkward files
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Resumes, IDs, contracts, family photos. The stuff you would not
              drop on a random converter.
            </p>
          </div>
          <div>
            <Zap className="size-6 text-signal" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              Chain tools, skip re-picks
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Finish one job, hit Continue with, and the next tool already has
              your result. That is the difference from hopping five sites.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}
