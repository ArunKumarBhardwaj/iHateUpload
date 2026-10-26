import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ExamPhotoStudio } from "@/components/exam-photo/exam-photo-studio";
import { FaqSection } from "@/components/seo/faq-section";
import { JsonLd } from "@/components/seo/json-ld";
import { ToolIcon } from "@/components/tool-icon";
import { dpiRule, examFaq, examSeo, pixelRule } from "@/lib/exam-photo/seo";
import { EXAMS, getExam } from "@/lib/exam-photo/specs";
import { breadcrumbLd, faqPageLd } from "@/lib/seo/json-ld";
import { siteUrl } from "@/lib/site";

type ExamPageProps = PageProps<"/exam-photo/[exam]">;

export const dynamicParams = false;

export function generateStaticParams() {
  return EXAMS.map((e) => ({ exam: e.slug }));
}

export async function generateMetadata({ params }: ExamPageProps): Promise<Metadata> {
  const { exam: slug } = await params;
  const exam = getExam(slug);
  if (!exam) return {};
  const { title, description } = examSeo(exam);
  const url = `/exam-photo/${exam.slug}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function ExamPhotoPage({ params }: ExamPageProps) {
  const { exam: slug } = await params;
  const exam = getExam(slug);
  if (!exam) notFound();

  const { sizes, description, heading } = examSeo(exam);
  const faq = examFaq(exam);
  const howTo = [
    `Add your ${exam.slots.map((s) => s.label.toLowerCase()).join(", ")}. ${exam.name} rules are already loaded.`,
    exam.slots.some((s) => s.kind === "photo")
      ? "Drag and zoom to frame your face. Signatures are trimmed to the ink and the paper is cleaned to white."
      : "Sign on plain white paper and take a photo. The tool trims it to the ink and cleans the paper to white.",
    "Download each file once every check shows a green tick.",
  ];

  const appLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: heading,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
    description,
    url: siteUrl(`/exam-photo/${exam.slug}`),
  };
  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `How to resize images for ${exam.name}`,
    description,
    step: howTo.map((text, i) => ({ "@type": "HowToStep", position: i + 1, text })),
  };

  // One trail feeds both the visible breadcrumb and its structured data, so they can't drift apart.
  const trail = [
    { name: "Home", short: "Home", path: "/" },
    { name: "Exam Photo & Signature Resizer", short: "Exam Photo", path: "/tools/exam-photo" },
    { name: heading, short: exam.name, path: `/exam-photo/${exam.slug}` },
  ];

  return (
    <div className="mx-auto max-w-[90rem] px-6 py-8 sm:py-10">
      <JsonLd data={appLd} />
      <JsonLd data={howToLd} />
      <JsonLd data={faqPageLd(faq)} />
      <JsonLd data={breadcrumbLd(trail)} />

      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          {trail.map((crumb, i) =>
            i < trail.length - 1 ? (
              <li key={crumb.path} className="flex items-center gap-1.5">
                <Link href={crumb.path} className="hover:text-ink hover:underline">
                  {crumb.short}
                </Link>
                <ChevronRight aria-hidden className="size-3.5" />
              </li>
            ) : (
              <li key={crumb.path} aria-current="page" className="font-medium text-ink">
                {crumb.short}
              </li>
            ),
          )}
        </ol>
      </nav>

      <div className="mx-auto mb-8 flex max-w-2xl flex-col items-center text-center">
        <ToolIcon id="exam-photo" className="size-14" />
        <h1 className="mt-4 text-balance text-3xl font-semibold leading-tight tracking-tight text-ink sm:text-4xl">
          {heading}
        </h1>
        <p className="mt-2 text-balance text-base text-muted-foreground sm:text-lg">
          {sizes.charAt(0).toUpperCase() + sizes.slice(1)}, JPG. Every file is checked against the rules before you download, and nothing is uploaded.
        </p>
      </div>

      <div className="mx-auto max-w-5xl">
        <ExamPhotoStudio key={exam.slug} initial={exam.slug} />
      </div>

      <section className="mx-auto mt-12 max-w-5xl">
        <h2 className="text-balance text-2xl font-semibold text-ink">
          {exam.name} {exam.slots.some((s) => s.kind === "photo") ? "photo and signature" : "signature"} size
        </h2>
        <div className="mt-5 overflow-x-auto rounded-2xl border border-ink/8 bg-card">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <thead className="border-b border-ink/8 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Image</th>
                <th className="px-4 py-3 font-medium">File size</th>
                <th className="px-4 py-3 font-medium">Pixels</th>
                <th className="px-4 py-3 font-medium">Other rules</th>
              </tr>
            </thead>
            <tbody>
              {exam.slots.map((s) => (
                <tr key={s.kind} className="border-b border-ink/6 align-top last:border-0">
                  <td className="px-4 py-3 font-medium text-ink">{s.label}</td>
                  <td className="px-4 py-3 tabular-nums text-ink">
                    {s.minKb > 0 ? `${s.minKb}–${s.maxKb} KB` : `Up to ${s.maxKb} KB`}, JPG
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink">
                    {pixelRule(s)}
                    {dpiRule(s) ? `, ${dpiRule(s)}` : ""}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {s.rules?.join(" ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Source:{" "}
          <a
            href={exam.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-signal-ink underline-offset-2 hover:underline"
          >
            {exam.source.title}
          </a>{" "}
          ({exam.source.date}). Checked {exam.checked}. Rules can change between exam cycles, so compare with the notice for yours.
        </p>
      </section>

      <section className="mx-auto mt-12 max-w-5xl">
        <h2 className="text-balance text-2xl font-semibold text-ink">
          How to make {exam.name} upload images
        </h2>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {howTo.map((step, index) => (
            <li key={step} className="rounded-2xl border border-ink/8 bg-card p-4">
              <p className="text-sm font-semibold text-signal-ink">Step {index + 1}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink">{step}</p>
            </li>
          ))}
        </ol>
      </section>

      <div className="mx-auto max-w-5xl">
        <FaqSection items={faq} />
      </div>

      <section className="mx-auto mt-12 max-w-5xl">
        <h2 className="text-balance text-2xl font-semibold text-ink">Other exams and forms</h2>
        <ul className="mt-5 flex flex-wrap gap-2">
          {EXAMS.filter((e) => e.slug !== exam.slug).map((e) => (
            <li key={e.slug}>
              <Link
                href={`/exam-photo/${e.slug}`}
                className="inline-flex rounded-xl border border-ink/10 bg-card px-4 py-2 text-sm font-medium text-ink hover:bg-surface"
              >
                {e.name} photo size
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
