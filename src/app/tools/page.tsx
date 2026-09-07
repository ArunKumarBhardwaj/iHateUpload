import type { Metadata } from "next";

import { ToolCardGrid } from "@/components/tool-card";
import { TOOLS } from "@/lib/tools";

const PDF_TOOLS = TOOLS.filter((tool) => tool.kind === "pdf");
const IMAGE_TOOLS = TOOLS.filter((tool) => tool.kind === "image");

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
  return (
    <div className="mx-auto max-w-[90rem] px-6 py-10 sm:py-12">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">
          All tools
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Every tool in this tab
        </h1>
        <p className="mt-3 text-base text-muted-foreground">
          Compress a photo, merge a PDF, or convert a file. Nothing uploads.
        </p>
      </div>

      <section className="mt-10">
        <h2 className="text-2xl font-semibold text-ink">Image tools</h2>
        <div className="mt-5">
          <ToolCardGrid tools={IMAGE_TOOLS} />
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">PDF tools</h2>
        <div className="mt-5">
          <ToolCardGrid tools={PDF_TOOLS} />
        </div>
      </section>
    </div>
  );
}
