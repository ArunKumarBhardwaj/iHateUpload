import type { Metadata } from "next";

import { ToolCardGrid } from "@/components/tool-card";
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
  "redact-pdf",
  "compare-pdfs",
  "sign-pdf",
  "crop-pdf",
  "compress-pdf",
  "extract-pages",
  "compress-image",
  "pdf-to-jpg",
  "heic-to-jpg",
];

const PDF_TOOLS = TOOLS.filter((tool) => tool.kind === "pdf");
const IMAGE_TOOLS = TOOLS.filter((tool) => tool.kind === "image");

function toolsById(ids: readonly ToolId[]) {
  return ids
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);
}

export default function HomePage() {
  return (
    <div className="mx-auto max-w-[90rem] px-6">
      <section className="pt-10 pb-6 sm:pt-12 sm:pb-8">
        <h1 className="max-w-4xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
          PDF and image tools that never leave this tab.
        </h1>
        <p className="mt-4 max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Merge, compress, convert, sign, and crop on this device. No account.
          No watermark. No daily cap.
        </p>
      </section>

      <section id="tools" className="scroll-mt-24 pb-10 sm:pb-12">
        <SectionHead
          eyebrow="Popular"
          title="Most used tools"
          copy="The jobs people open first."
        />
        <div className="mt-6">
          <ToolCardGrid tools={toolsById(POPULAR)} />
        </div>
      </section>

      <section
        id="pdf-tools"
        className="scroll-mt-24 border-t border-ink/8 py-10 sm:py-12"
      >
        <SectionHead
          eyebrow="PDF"
          title="PDF tools"
          copy="Merge, compress, convert, protect, sign, and organize in the browser."
        />
        <div className="mt-6">
          <ToolCardGrid tools={PDF_TOOLS} />
        </div>
      </section>

      <section
        id="image-tools"
        className="scroll-mt-24 border-t border-ink/8 py-10 sm:py-12"
      >
        <SectionHead
          eyebrow="Images"
          title="Image tools"
          copy="Compress, resize, and convert JPG, PNG, WebP, and HEIC."
        />
        <div className="mt-6">
          <ToolCardGrid tools={IMAGE_TOOLS} />
        </div>
      </section>
    </div>
  );
}

function SectionHead({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-signal">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">
        {title}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground sm:text-base">{copy}</p>
    </div>
  );
}
