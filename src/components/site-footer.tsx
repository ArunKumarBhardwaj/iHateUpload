import Link from "next/link";

import { TOOLS } from "@/lib/tools";

const PDF_TOOLS = TOOLS.filter((tool) => tool.kind === "pdf" && tool.showInNav);
const IMAGE_TOOLS = TOOLS.filter(
  (tool) => tool.kind === "image" && tool.showInNav,
);

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-auto font-sans">
      <div className="border-t border-ink/10 bg-background">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-4">
          <div>
            <p className="text-xl font-semibold tracking-tight text-ink">
              iHate<span className="text-signal">Upload</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              We refuse the upload.
            </p>
          </div>
          <FooterCol title="PDF tools" tools={PDF_TOOLS.slice(0, 8)} />
          <FooterCol title="Image tools" tools={IMAGE_TOOLS} />
          <div>
            <p className="text-sm font-semibold tracking-tight text-ink">
              Company
            </p>
            <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
              <li>
                <Link href="/#tools" className="hover:text-ink">
                  All tools
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-ink">
                  Privacy
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <div className="bg-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© 2026 iHateUpload. Made for people who hate the upload.</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-1">
            <Link href="/privacy" className="hover:text-ink">
              Privacy
            </Link>
            <Link href="/#tools" className="hover:text-ink">
              All tools
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  tools,
}: {
  title: string;
  tools: { slug: string; title: string }[];
}) {
  return (
    <div>
      <p className="text-sm font-semibold tracking-tight text-ink">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
        {tools.map((tool) => (
          <li key={tool.slug}>
            <Link href={`/tools/${tool.slug}`} className="hover:text-ink">
              {tool.title}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
