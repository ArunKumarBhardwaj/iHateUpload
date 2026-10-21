import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FaqSection } from "@/components/seo/faq-section";
import { JsonLd } from "@/components/seo/json-ld";
import { ToolCardGrid } from "@/components/tool-card";
import { ToolIcon } from "@/components/tool-icon";
import { ToolWorkspace } from "@/components/tool-workspace";
import { breadcrumbLd, faqPageLd } from "@/lib/seo/json-ld";
import { siteUrl } from "@/lib/site";
import { TOOL_FAQ } from "@/lib/tool-faq";
import { getTool, TOOLS } from "@/lib/tools";

type ToolPageProps = PageProps<"/tools/[slug]">;

export function generateStaticParams() {
  return TOOLS.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: ToolPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};

  const url = `/tools/${tool.slug}`;
  return {
    title: tool.seoTitle,
    description: tool.seoDescription,
    alternates: { canonical: url },
    openGraph: {
      title: tool.seoTitle,
      description: tool.seoDescription,
      url,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: tool.seoTitle,
      description: tool.seoDescription,
    },
  };
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  const related = TOOLS.filter(
    (t) => t.id !== tool.id && t.kind === tool.kind,
  ).slice(0, 8);

  const faq = TOOL_FAQ[tool.id];

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: tool.title,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    description: tool.seoDescription,
    url: siteUrl(`/tools/${tool.slug}`),
    featureList: [
      "No file upload",
      "Runs in the browser",
      "Free",
      "No watermark",
    ],
  };

  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to use ${tool.title}`,
    description: tool.seoDescription,
    step: tool.seoHowTo.map((text, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      text,
    })),
  };

  return (
    <div className="mx-auto max-w-[90rem] px-6 py-8 sm:py-10">
      <JsonLd data={jsonLd} />
      <JsonLd data={howToLd} />
      <JsonLd data={faqPageLd(faq)} />
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Tools", path: "/tools" },
          { name: tool.title, path: `/tools/${tool.slug}` },
        ])}
      />

      <div className="mx-auto mb-10 flex max-w-3xl flex-col items-center text-center sm:mb-12">
        <ToolIcon id={tool.id} className="size-14" />
        <h1 className="mt-5 text-balance text-5xl leading-[0.95] font-semibold tracking-[-0.04em] text-ink sm:text-7xl">
          {tool.title}
        </h1>
        <p className="mt-4 max-w-xl text-balance text-base leading-relaxed text-muted-foreground sm:text-lg">
          {tool.description}
        </p>
      </div>

      {/* Keyed so navigating between tools starts from a clean workspace. */}
      <ToolWorkspace key={tool.id} tool={tool} />

      <section className="mt-20">
        <h2 className="text-balance text-3xl font-semibold text-ink sm:text-4xl">
          How to use {tool.title}
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {tool.seoHowTo.map((step, index) => (
            <li
              key={step}
              className="rounded-[1.5rem] bg-card p-5 ring-1 ring-ink/6"
            >
              <p className="font-display text-3xl font-semibold text-ink/25 tabular-nums">
                {index + 1}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink">{step}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {tool.seoDescription}
          {tool.ui === "ask"
            ? " The extracted text and your chat are sent to Google Gemini to get an answer, through our server or, with your own key, straight from this browser."
            : " Processing never leaves this tab."}
        </p>
      </section>

      <FaqSection items={faq} />

      {related.length > 0 && (
        <section className="mt-20">
          <h2 className="text-balance text-3xl font-semibold text-ink sm:text-4xl">
            Related {tool.kind === "pdf" ? "PDF" : "image"} tools
          </h2>
          <div className="mt-5">
            <ToolCardGrid tools={related} />
          </div>
        </section>
      )}
    </div>
  );
}
