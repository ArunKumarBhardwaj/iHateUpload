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
  return {
    title: tool.seoTitle,
    description: tool.seoDescription,
  };
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
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

      <div className="mx-auto mt-10 max-w-3xl text-sm text-muted-foreground">
        <p>
          Need something else?{" "}
          {TOOLS.filter((t) => t.id !== tool.id).map((t, i, arr) => (
            <span key={t.id}>
              <Link
                href={`/tools/${t.slug}`}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {t.title}
              </Link>
              {i < arr.length - 1 ? " · " : ""}
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}
