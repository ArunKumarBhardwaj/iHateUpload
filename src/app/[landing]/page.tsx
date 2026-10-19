import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FaqSection } from "@/components/seo/faq-section";
import { JsonLd } from "@/components/seo/json-ld";
import { ToolIcon } from "@/components/tool-icon";
import { ToolWorkspace } from "@/components/tool-workspace";
import {
  COMPRESS_TARGETS,
  getCompressTarget,
} from "@/lib/seo/compress-targets";
import { breadcrumbLd, faqPageLd } from "@/lib/seo/json-ld";
import { siteUrl } from "@/lib/site";
import { getTool } from "@/lib/tools";

type LandingPageProps = PageProps<"/[landing]">;

// Only the listed landing pages exist; any other top-level path is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return COMPRESS_TARGETS.map((t) => ({ landing: t.slug }));
}

export async function generateMetadata({
  params,
}: LandingPageProps): Promise<Metadata> {
  const { landing } = await params;
  const page = getCompressTarget(landing);
  if (!page) return {};

  const url = `/${page.slug}`;
  return {
    title: page.seoTitle,
    description: page.seoDescription,
    alternates: { canonical: url },
    openGraph: {
      title: page.seoTitle,
      description: page.seoDescription,
      url,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: page.seoTitle,
      description: page.seoDescription,
    },
  };
}

export default async function CompressTargetPage({
  params,
}: LandingPageProps) {
  const { landing } = await params;
  const page = getCompressTarget(landing);
  const tool = getTool("compress-pdf");
  if (!page || !tool) notFound();

  const howTo = [
    "Choose the PDF you want to shrink. It is opened in this tab, not uploaded.",
    `Keep the ${page.label} target, or pick another size or level.`,
    `Press Compress PDF and download a file of ${page.label} or less.`,
  ];

  const appLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `Compress PDF to ${page.label}`,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    description: page.seoDescription,
    url: siteUrl(`/${page.slug}`),
  };

  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to compress a PDF to ${page.label}`,
    description: page.seoDescription,
    step: howTo.map((text, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      text,
    })),
  };

  const others = COMPRESS_TARGETS.filter((t) => t.slug !== page.slug);

  return (
    <div className="mx-auto max-w-[90rem] px-6 py-8 sm:py-10">
      <JsonLd data={appLd} />
      <JsonLd data={howToLd} />
      <JsonLd data={faqPageLd(page.faq)} />
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Compress PDF", path: "/tools/compress-pdf" },
          { name: `Compress PDF to ${page.label}`, path: `/${page.slug}` },
        ])}
      />

      <div className="mx-auto mb-8 flex max-w-2xl flex-col items-center text-center">
        <ToolIcon id={tool.id} className="size-14" />
        <h1 className="mt-4 text-balance text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          Compress PDF to {page.label}
        </h1>
        <p className="mt-2 text-balance text-base text-muted-foreground sm:text-lg">
          {page.intro}
        </p>
      </div>

      <ToolWorkspace
        key={page.slug}
        tool={tool}
        preset={{ kind: "compress", level: "light", targetKb: page.targetKb }}
      />

      <section className="mt-12">
        <h2 className="text-balance text-2xl font-semibold text-ink">
          How to compress a PDF to {page.label}
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {howTo.map((step, index) => (
            <li key={step} className="rounded-2xl border border-ink/8 bg-card p-4">
              <p className="text-sm font-semibold text-signal-ink">
                Step {index + 1}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-ink">{step}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          Images are resampled to the size the page draws them and re-encoded
          step by step until the file is {page.label} or less. Text, links and
          form fields are not touched, so text stays sharp and selectable.
          Processing never leaves this tab.
        </p>
      </section>

      <FaqSection items={page.faq} />

      <section className="mt-12">
        <h2 className="text-balance text-2xl font-semibold text-ink">
          Other sizes
        </h2>
        <ul className="mt-5 flex flex-wrap gap-2">
          {others.map((t) => (
            <li key={t.slug}>
              <Link
                href={`/${t.slug}`}
                className="inline-flex rounded-xl border border-ink/10 bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
              >
                Compress PDF to {t.label}
              </Link>
            </li>
          ))}
          <li>
            <Link
              href="/tools/compress-pdf"
              className="inline-flex rounded-xl border border-ink/10 bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
            >
              Compress PDF (any size)
            </Link>
          </li>
          <li>
            <Link
              href="/tools/compress-to-size"
              className="inline-flex rounded-xl border border-ink/10 bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
            >
              Compress an image to a size
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
