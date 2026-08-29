import Link from "next/link";
import { ArrowRight, Lock, ShieldOff, Zap } from "lucide-react";

import { TOOLS, type ToolId } from "@/lib/tools";

const POPULAR: ToolId[] = [
  "merge-pdf",
  "compress-pdf",
  "heic-to-jpg",
  "resize-image",
  "png-to-jpg",
  "heic-to-pdf",
];

const PDF_IDS: ToolId[] = TOOLS.filter((t) => t.kind === "pdf").map((t) => t.id);
const IMAGE_IDS: ToolId[] = TOOLS.filter((t) => t.kind === "image").map(
  (t) => t.id,
);

function ToolCards({ ids }: { ids: readonly ToolId[] }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {ids.map((id) => {
        const tool = TOOLS.find((entry) => entry.id === id);
        if (!tool) return null;
        return (
          <Link
            key={tool.id}
            href={`/tools/${tool.slug}`}
            className="group flex h-full flex-col rounded-2xl border border-ink/12 bg-card/80 p-5 transition-colors hover:border-signal/40 hover:bg-signal/5"
          >
            <h3 className="font-display text-xl font-bold text-ink group-hover:text-signal">
              {tool.title}
            </h3>
            <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">
              {tool.description}
            </p>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-ink">
              Open tool
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-10 h-72 w-72 rounded-full bg-signal/20 blur-3xl" />
          <div className="absolute -right-16 bottom-0 h-80 w-80 rounded-full bg-lagoon/20 blur-3xl" />
        </div>

        <div className="relative mx-auto flex min-h-[72vh] max-w-6xl flex-col items-center justify-center px-4 py-16 text-center sm:px-6 sm:py-20">
          <p className="animate-rise font-display text-5xl font-bold leading-[1.05] tracking-tight text-ink sm:text-7xl md:text-8xl">
            iHate
            <span className="text-signal">Upload</span>
          </p>
          <h1 className="animate-rise-delay mt-5 max-w-2xl font-display text-2xl font-semibold leading-tight text-ink/90 sm:text-3xl md:text-4xl">
            Free file tools that refuse to touch your cloud.
          </h1>
          <p className="animate-rise-delay-2 mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Pick a tool. Work stays in this tab. Zero cloud hops.
          </p>

          <div className="animate-rise-delay-2 mt-10 w-full max-w-5xl text-left">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
              Popular tools
            </p>
            <ToolCards ids={POPULAR} />
          </div>
        </div>
      </section>

      <section id="tools" className="border-t border-ink/10 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Zero cloud hops.
            </h2>
            <p className="mt-3 text-muted-foreground">
              One place for PDF and image jobs that usually force you across five
              upload sites.
            </p>
          </div>

          <div id="pdf-tools" className="mt-14 scroll-mt-24">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
              PDF
            </p>
            <ToolCards ids={PDF_IDS} />
          </div>

          <div id="image-tools" className="mt-14 scroll-mt-24">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
              Images
            </p>
            <ToolCards ids={IMAGE_IDS} />
          </div>
        </div>
      </section>

      <section className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 text-center sm:grid-cols-3 sm:px-6 sm:text-left">
          <div>
            <ShieldOff className="mx-auto size-6 text-signal sm:mx-0" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              Zero cloud hops
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Your file never takes a trip to our servers, because we do not have
              one for it. Load the page, kill wifi, keep working.
            </p>
          </div>
          <div>
            <Lock className="mx-auto size-6 text-lagoon sm:mx-0" />
            <h3 className="mt-3 font-display text-xl font-bold text-ink">
              Built for awkward files
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Resumes, IDs, contracts, family photos. The stuff you would not
              drop on a random converter.
            </p>
          </div>
          <div>
            <Zap className="mx-auto size-6 text-signal sm:mx-0" />
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
