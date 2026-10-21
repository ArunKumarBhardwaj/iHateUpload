import type { Metadata } from "next";

import { FaqSection } from "@/components/seo/faq-section";
import { JsonLd } from "@/components/seo/json-ld";
import { WorkflowBuilder } from "@/components/workflow/workflow-builder";
import { breadcrumbLd, faqPageLd } from "@/lib/seo/json-ld";
import { siteUrl } from "@/lib/site";
import type { FaqItem } from "@/lib/tool-faq";

const TITLE = "PDF Workflow Builder, Batch Many Files — No Upload";
const DESCRIPTION =
  "Chain tools like merge, compress and protect, then run them on many PDFs or images at once. Free, no upload: everything runs in your browser.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/tools/workflow" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/tools/workflow",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const FAQ: FaqItem[] = [
  {
    q: "How many files can a workflow run on?",
    a: "As many as your device can hold. Files go through the steps a couple at a time, so a long list does not need all of them open at once. One file failing never stops the rest.",
  },
  {
    q: "Are my files uploaded?",
    a: "No. Every step runs in this tab with the same code as the single tools. Nothing is sent anywhere.",
  },
  {
    q: "Can I share a workflow?",
    a: "Yes. The share link holds only the steps and their settings, in the part of the address a server never sees. Files and passwords are never included, so the person you send it to types their own password.",
  },
  {
    q: "What happens with merge or split in a chain?",
    a: "Merge takes every file and makes one. Split and PDF to images turn one file into several, and the next step runs on each piece.",
  },
  {
    q: "Which tools can I use?",
    a: "The ones that run from their settings alone: merge, compress, protect, unlock, rotate, flatten, OCR, watermark, page numbers and more, plus the image tools. Tools that need you on the page, like sign, edit or redact, are left out.",
  },
];

export default function WorkflowPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Workflow Builder",
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    description: DESCRIPTION,
    url: siteUrl("/tools/workflow"),
    featureList: ["No file upload", "Runs in the browser", "Batch many files", "Free"],
  };

  return (
    <div className="mx-auto max-w-[90rem] px-6 py-8 sm:py-10">
      <JsonLd data={jsonLd} />
      <JsonLd data={faqPageLd(FAQ)} />
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Tools", path: "/tools" },
          { name: "Workflow Builder", path: "/tools/workflow" },
        ])}
      />

      <div className="mx-auto mb-8 flex max-w-2xl flex-col items-center text-center">
        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          Workflow Builder
        </h1>
        <p className="mt-2 text-balance text-base text-muted-foreground sm:text-lg">
          Chain steps, drop many files, get them all back. Merge, compress and
          protect in one go. Runs on your device.
        </p>
      </div>

      <div className="mx-auto max-w-5xl">
        <WorkflowBuilder />
      </div>

      <div className="mx-auto max-w-5xl">
        <FaqSection items={FAQ} />
      </div>
    </div>
  );
}
