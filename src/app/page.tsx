import type { Metadata } from "next";

import { Check } from "lucide-react";
import Link from "next/link";

import { HomeDrop } from "@/components/home-drop";
import { ToolCatalog } from "@/components/tool-catalog";
import { TOOL_GROUPS } from "@/lib/tool-groups";
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

// "All tools" opens with these, in this order, then the rest by job.
const POPULAR: ToolId[] = [
  "compress-pdf",
  "merge-pdf",
  "word-to-pdf",
  "image-to-pdf",
  "pdf-to-jpg",
  "edit-pdf",
  "sign-pdf",
  "compress-image",
  "heic-to-jpg",
  "split-pdf",
];

const PROOF = [
  "Zero bytes uploaded",
  "Works offline",
  "No account or watermark",
];

function toolsById(ids: readonly ToolId[]) {
  return ids
    .map((id) => TOOLS.find((tool) => tool.id === id))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined);
}

const GROUPS = TOOL_GROUPS.map((group) => ({
  ...group,
  tools: toolsById(group.tools),
}));

const ALL = [
  ...toolsById(POPULAR),
  ...GROUPS.flatMap((group) => group.tools).filter(
    (tool) => !POPULAR.includes(tool.id),
  ),
];

export default function HomePage() {
  return (
    <>
      <section className="mx-auto max-w-[90rem] px-6 pt-12 pb-16 text-center sm:pt-16 sm:pb-24">
        <h1 className="mx-auto max-w-4xl text-balance text-4xl font-semibold leading-[1.06] tracking-tight text-ink sm:text-6xl">
          Edit, convert, and shrink files. Nothing leaves this tab.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          {TOOLS.length} free PDF and image tools that run on your device, so
          contracts, IDs, and medical records never touch a server.
        </p>
        <ul className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-2">
          {PROOF.map((line) => (
            <li
              key={line}
              className="flex items-center gap-1.5 text-sm font-medium text-ink"
            >
              <Check className="size-4 text-lagoon" aria-hidden />
              {line}
            </li>
          ))}
        </ul>
        <div className="mx-auto mt-10 max-w-3xl text-left sm:mt-14">
          <HomeDrop />
        </div>
        <Link
          href="/privacy"
          className="mt-6 inline-block text-sm font-medium text-signal-ink underline-offset-4 hover:underline"
        >
          How your files stay private
        </Link>
      </section>

      <section
        id="all-tools"
        className="scroll-mt-20 border-t border-ink/6 bg-surface py-14 sm:py-20"
      >
        <div className="mx-auto max-w-[90rem] px-6">
          <h2 className="text-balance text-center text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Every tool you need, in one tab
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Pick a job, or start from the most used.
          </p>
          <div className="mt-8 sm:mt-10">
            <ToolCatalog all={ALL} groups={GROUPS} />
          </div>
          <div className="mx-auto mt-8 flex max-w-3xl flex-col items-center gap-3 rounded-2xl border border-ink/10 bg-card px-6 py-5 text-center sm:flex-row sm:text-left">
            <div className="flex-1">
              <p className="text-base font-semibold text-ink">
                Many files, several steps?
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Chain merge, compress, protect and more, then run them on a whole
                batch at once. Still in this tab.
              </p>
            </div>
            <Link
              href="/tools/workflow"
              className="pressable inline-flex h-10 shrink-0 items-center rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground"
            >
              Build a workflow
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
