import Link from "next/link";

import { TOOLS } from "@/lib/tools";

const PDF_TOOLS = TOOLS.filter((tool) => tool.kind === "pdf" && tool.showInNav);
const IMAGE_TOOLS = TOOLS.filter(
  (tool) => tool.kind === "image" && tool.showInNav,
);

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-auto border-t border-ink/8 bg-card">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-1">
          <p className="font-display text-lg font-bold text-ink">
            iHate<span className="text-signal">Upload</span>
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            PDF and image tools that finish in this tab. We refuse the upload.
          </p>
        </div>
        <FooterCol title="PDF tools" tools={PDF_TOOLS.slice(0, 8)} />
        <FooterCol title="Image tools" tools={IMAGE_TOOLS} />
        <div>
          <p className="text-sm font-semibold text-ink">Company</p>
          <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
            <li>
              <Link href="/privacy" className="hover:text-ink">
                Privacy
              </Link>
            </li>
            <li>
              <Link href="/#tools" className="hover:text-ink">
                All tools
              </Link>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink/8">
        <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted-foreground sm:px-6">
          Work stays on this device. No account. No watermark.
        </p>
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
      <p className="text-sm font-semibold text-ink">{title}</p>
      <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
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
