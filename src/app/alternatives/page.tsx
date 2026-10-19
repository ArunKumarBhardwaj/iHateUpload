import type { Metadata } from "next";
import Link from "next/link";

import { JsonLd } from "@/components/seo/json-ld";
import { COMPARE_ROWS, RIVAL } from "@/lib/seo/alternatives";
import { breadcrumbLd } from "@/lib/seo/json-ld";

const TITLE = "Alternatives and Comparisons";
const DESCRIPTION =
  "How iHateUpload compares with other in-browser PDF tools, tool by tool, with the tests behind every verdict.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/alternatives" },
  openGraph: { title: TITLE, description: DESCRIPTION, url: "/alternatives", type: "website" },
};

export default function AlternativesPage() {
  const ahead = COMPARE_ROWS.filter((r) => r.verdict === "better").length;
  return (
    <div className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
      <JsonLd
        data={breadcrumbLd([
          { name: "Home", path: "/" },
          { name: "Alternatives", path: "/alternatives" },
        ])}
      />
      <h1 className="text-balance text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
        {TITLE}
      </h1>
      <p className="mt-3 text-base leading-relaxed text-muted-foreground">
        {DESCRIPTION} We only compare against tools that, like us, keep your
        files in the browser. Every verdict comes from a dated test on
        synthetic files, and we list where the other tool is ahead too.
      </p>
      <ul className="mt-8 grid gap-3">
        <li>
          <Link
            href={`/alternatives/${RIVAL.slug}`}
            className="block rounded-2xl border border-ink/8 bg-card p-5 hover:bg-surface"
          >
            <span className="text-lg font-semibold text-ink">
              iHateUpload vs {RIVAL.name}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {COMPARE_ROWS.length} features compared; we are ahead on {ahead}.
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}
