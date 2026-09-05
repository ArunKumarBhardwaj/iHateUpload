import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ToolCardGrid } from "@/components/tool-card";
import { ToolWorkspace } from "@/components/tool-workspace";
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
    url: `https://ihateupload.com/tools/${tool.slug}`,
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToLd) }}
      />

      <div className="mb-6 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal">
          Upload-free tool
        </p>
        <h1 className="mt-2 text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          {tool.title}
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          {tool.description}
        </p>
      </div>

      {/* Keyed so navigating between tools starts from a clean workspace. */}
      <ToolWorkspace key={tool.id} tool={tool} />

      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">
          How to {tool.title.toLowerCase()} online
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {tool.seoHowTo.map((step, index) => (
            <li
              key={step}
              className="rounded-2xl border border-ink/8 bg-card p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-signal">
                Step {index + 1}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink">{step}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          {tool.seoDescription} Processing never leaves this tab.
        </p>
      </section>

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-2xl font-semibold text-ink">
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
