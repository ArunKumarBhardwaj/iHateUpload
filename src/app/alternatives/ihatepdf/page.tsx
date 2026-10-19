import type { Metadata } from "next";
import Link from "next/link";

import { CompareList } from "@/components/seo/compare";
import { JsonLd } from "@/components/seo/json-ld";
import { COMPARE_ROWS, ONLY_OURS, RIVAL } from "@/lib/seo/alternatives";
import { breadcrumbLd } from "@/lib/seo/json-ld";
import { getTool } from "@/lib/tools";

const TITLE = `${RIVAL.name} Alternative — iHateUpload vs ${RIVAL.name}`;
const DESCRIPTION = `An honest ${RIVAL.name} alternative: both keep files in your browser. See where iHateUpload is ahead, where it is even, and where ${RIVAL.name} still leads, with the test behind each verdict.`;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/alternatives/${RIVAL.slug}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `/alternatives/${RIVAL.slug}`,
    type: "article",
  },
};

export default function RivalPage() {
  const better = COMPARE_ROWS.filter((r) => r.verdict === "better");
  const equal = COMPARE_ROWS.filter((r) => r.verdict === "equal");
  const gap = COMPARE_ROWS.filter((r) => r.verdict === "gap");
  const onlyOurs = ONLY_OURS.map(getTool).filter((t) => t !== undefined);

  return (
    <div className="mx-auto max-w-[90rem] px-6 py-12 sm:py-16">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Alternatives", path: "/alternatives" },
          { name: `vs ${RIVAL.name}`, path: `/alternatives/${RIVAL.slug}` },
        ])}
      />
      <div className="mx-auto max-w-3xl">
        <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          iHateUpload vs {RIVAL.name}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {RIVAL.summary}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Their site changes; each verdict carries the date we checked it.
        </p>
      </div>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">
          Where iHateUpload is ahead ({better.length})
        </h2>
        <CompareList rows={better} />
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">
          Where we are even ({equal.length})
        </h2>
        <CompareList rows={equal} />
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">
          Where {RIVAL.name} is ahead ({gap.length})
        </h2>
        <CompareList rows={gap} />
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold text-ink">
          Tools only iHateUpload has
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Not in {RIVAL.name}&apos;s sitemap when we checked on 2026-10-17.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {onlyOurs.map((tool) => (
            <li key={tool.id}>
              <Link
                href={`/tools/${tool.slug}`}
                className="inline-flex rounded-xl border border-ink/10 bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
              >
                {tool.title}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
