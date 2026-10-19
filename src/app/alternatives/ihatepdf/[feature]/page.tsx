import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CompareList, VerdictBadge } from "@/components/seo/compare";
import { JsonLd } from "@/components/seo/json-ld";
import { comparePages, getComparePage, RIVAL } from "@/lib/seo/alternatives";
import { breadcrumbLd } from "@/lib/seo/json-ld";
import { getTool } from "@/lib/tools";

type FeaturePageProps = PageProps<"/alternatives/ihatepdf/[feature]">;

export const dynamicParams = false;

export function generateStaticParams() {
  return comparePages().map((row) => ({ feature: row.slug! }));
}

function copy(feature: string) {
  return {
    title: `${RIVAL.name} ${feature} Alternative — Side-by-Side Test`,
    description: `${feature}: iHateUpload vs ${RIVAL.name}, both in-browser with no upload. What each does, how we tested it, and the result.`,
  };
}

export async function generateMetadata({
  params,
}: FeaturePageProps): Promise<Metadata> {
  const { feature } = await params;
  const row = getComparePage(feature);
  if (!row) return {};
  const { title, description } = copy(row.feature);
  const url = `/alternatives/${RIVAL.slug}/${row.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "article" },
  };
}

export default async function FeaturePage({ params }: FeaturePageProps) {
  const { feature } = await params;
  const row = getComparePage(feature);
  if (!row) notFound();
  const tool = row.tool ? getTool(row.tool) : undefined;
  const others = comparePages().filter((r) => r.slug !== row.slug);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Alternatives", path: "/alternatives" },
          { name: `vs ${RIVAL.name}`, path: `/alternatives/${RIVAL.slug}` },
          { name: row.feature, path: `/alternatives/${RIVAL.slug}/${row.slug}` },
        ])}
      />
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {row.feature}: iHateUpload vs {RIVAL.name}
      </h1>
      <div className="mt-3">
        <VerdictBadge verdict={row.verdict} />
      </div>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        Both {RIVAL.name} and iHateUpload run {row.feature} in your browser
        without uploading the file. Here is what each one does and what
        happened when we ran the same synthetic test files through both.
      </p>

      <h2 className="mt-10 text-xl font-semibold text-ink">Side by side</h2>
      <CompareList rows={[row]} />

      {tool ? (
        <p className="mt-8">
          <Link
            href={`/tools/${tool.slug}`}
            className="inline-flex rounded-xl bg-ink px-5 py-3 text-sm font-semibold text-white hover:opacity-90"
          >
            Try {tool.title}, free and without upload
          </Link>
        </p>
      ) : null}

      <section className="mt-12">
        <h2 className="text-xl font-semibold text-ink">More comparisons</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          <li>
            <Link
              href={`/alternatives/${RIVAL.slug}`}
              className="inline-flex rounded-xl border border-ink/10 bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
            >
              Full comparison
            </Link>
          </li>
          {others.map((r) => (
            <li key={r.slug}>
              <Link
                href={`/alternatives/${RIVAL.slug}/${r.slug}`}
                className="inline-flex rounded-xl border border-ink/10 bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
              >
                {r.feature}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
