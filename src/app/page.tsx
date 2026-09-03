import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { TOOLS, type ToolId } from "@/lib/tools";

export const metadata: Metadata = {
  title: "Free Online PDF & Image Tools — No Upload",
  description:
    "Compress image, merge PDF, convert PDF to JPG, HEIC to JPG, and more — free in your browser. No upload, no signup, no watermark.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "Free Online PDF & Image Tools — No Upload",
    description:
      "Compress image, merge PDF, convert PDF, HEIC to JPG, and more. Files stay on your device.",
    url: "/",
    type: "website",
  },
};

const POPULAR: ToolId[] = [
  "merge-pdf",
  "sign-pdf",
  "crop-pdf",
  "compress-pdf",
  "extract-pages",
  "compress-image",
  "pdf-to-jpg",
  "heic-to-jpg",
  "image-to-pdf",
  "png-to-pdf",
];

const PDF_IDS: ToolId[] = TOOLS.filter((t) => t.kind === "pdf").map((t) => t.id);
const IMAGE_IDS: ToolId[] = TOOLS.filter((t) => t.kind === "image").map(
  (t) => t.id,
);

function ToolCards({ ids }: { ids: readonly ToolId[] }) {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {ids.map((id) => {
        const tool = TOOLS.find((entry) => entry.id === id);
        if (!tool) return null;
        return (
          <Link
            key={tool.id}
            href={`/tools/${tool.slug}`}
            className="group flex h-full flex-col rounded-2xl border border-ink/12 bg-card/80 p-5 transition-colors hover:border-signal/40 hover:bg-signal/5"
          >
            <h3 className="font-display text-lg font-bold text-ink group-hover:text-signal sm:text-xl">
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
      <section className="relative overflow-hidden border-b border-ink/10">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 top-0 h-56 w-56 rounded-full bg-signal/15 blur-3xl" />
          <div className="absolute -right-16 top-10 h-56 w-56 rounded-full bg-lagoon/15 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <h1 className="max-w-3xl font-display text-2xl font-bold leading-tight tracking-tight text-ink sm:text-3xl md:text-4xl">
            Free online PDF &amp; image tools — no upload
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            Compress image, merge PDF, convert PDF to JPG, HEIC to JPG, and more.
            Work stays in this tab. Zero cloud hops.
          </p>

          <div id="tools" className="mt-8 scroll-mt-24">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
              Popular tools
            </p>
            <ToolCards ids={POPULAR} />
          </div>
        </div>
      </section>

      <section className="py-10 sm:py-14">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div id="pdf-tools" className="scroll-mt-24">
            <h2 className="text-center font-display text-sm font-bold tracking-tight text-ink sm:text-base">
              PDF tools
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
              Merge, compress, convert, protect, and organize PDFs in your
              browser.
            </p>
            <ToolCards ids={PDF_IDS} />
          </div>

          <div id="image-tools" className="mt-12 scroll-mt-24 sm:mt-14">
            <h2 className="text-center font-display text-sm font-bold tracking-tight text-ink sm:text-base">
              Image tools
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-center text-sm text-muted-foreground">
              Compress, resize, and convert JPG, PNG, WebP, and HEIC — no upload.
            </p>
            <ToolCards ids={IMAGE_IDS} />
          </div>
        </div>
      </section>

      <section className="border-t border-ink/10 py-10 sm:py-12">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-display text-xl font-bold text-ink sm:text-2xl">
            Why iHateUpload
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Most free converters upload your files. These tools run in your
            browser instead — so resumes, IDs, contracts, and photos never leave
            your device. No account, no watermark, no daily cap.
          </p>
        </div>
      </section>
    </>
  );
}
