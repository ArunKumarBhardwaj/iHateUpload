import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

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
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howToLd) }}
      />

      <div className="mb-8 max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-lagoon">
          Upload-free tool
        </p>
        <h1 className="mt-2 font-display text-4xl font-bold leading-tight tracking-tight text-ink sm:text-5xl">
          {tool.title}
        </h1>
        <p className="mt-3 text-base text-muted-foreground sm:text-lg">
          {tool.description}
        </p>
      </div>

      <ToolWorkspace tool={tool} />

      <section className="mx-auto mt-12 max-w-3xl">
        <h2 className="font-display text-2xl font-bold text-ink">
          How to {tool.title.toLowerCase()} online
        </h2>
        <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {tool.seoHowTo.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">
          {tool.seoDescription} Processing never leaves this tab — cut wifi
          mid-job and it can still finish.
        </p>
      </section>

      {related.length > 0 && (
        <section className="mx-auto mt-10 max-w-3xl">
          <h2 className="font-display text-xl font-bold text-ink">
            Related {tool.kind === "pdf" ? "PDF" : "image"} tools
          </h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {related.map((t, i) => (
              <span key={t.id}>
                <Link
                  href={`/tools/${t.slug}`}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {t.title}
                </Link>
                {i < related.length - 1 ? " · " : ""}
              </span>
            ))}
          </p>
        </section>
      )}
    </div>
  );
}
