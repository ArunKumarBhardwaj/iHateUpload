import Link from "next/link";

import { FooterClaims } from "@/components/footer-claims";
import { GROUP_COLOR } from "@/components/tool-icon";
import { TOOL_GROUPS } from "@/lib/tool-groups";
import { getTool, type ToolId } from "@/lib/tools";

// The handful people search for by name; the full list lives on the homepage.
const MOST_USED: ToolId[] = [
  "compress-pdf",
  "merge-pdf",
  "word-to-pdf",
  "pdf-to-word",
  "pdf-to-jpg",
  "heic-to-jpg",
  "compress-to-size",
];

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-auto border-t border-ink/10 bg-background font-sans">
      <div className="mx-auto grid max-w-[90rem] grid-cols-2 gap-x-6 gap-y-10 px-6 py-14 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="col-span-2 max-w-xs lg:col-span-1">
          <p className="text-xl font-semibold tracking-tight text-ink">
            iHate<span className="text-brand">Upload</span>
          </p>
          <FooterClaims />
        </div>

        <FooterColumn title="Browse by category">
          {TOOL_GROUPS.map((group) => (
            <li key={group.id}>
              {/* A plain anchor so the hash change fires on the homepage too. */}
              <a
                href={`/#${group.id}`}
                className="inline-flex items-center gap-2 hover:text-ink"
              >
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: GROUP_COLOR[group.id] }}
                  aria-hidden
                />
                {group.title}
              </a>
            </li>
          ))}
        </FooterColumn>

        <FooterColumn title="Most used">
          {MOST_USED.map((id) => {
            const tool = getTool(id);
            if (!tool) return null;
            return (
              <li key={id}>
                <Link href={`/tools/${tool.slug}`} className="hover:text-ink">
                  {tool.title}
                </Link>
              </li>
            );
          })}
        </FooterColumn>

        <FooterColumn title="About">
          <li>
            <Link href="/privacy" className="hover:text-ink">
              How your files stay private
            </Link>
          </li>
          <li>
            <Link href="/privacy#check" className="hover:text-ink">
              Check it yourself
            </Link>
          </li>
          <li>
            <Link href="/tools" className="hover:text-ink">
              All tools A to Z
            </Link>
          </li>
          <li>
            <Link href="/alternatives" className="hover:text-ink">
              Compare alternatives
            </Link>
          </li>
        </FooterColumn>
      </div>

      <div className="border-t border-ink/8">
        <p className="mx-auto max-w-[90rem] px-6 py-5 text-xs text-muted-foreground">
          © 2026 iHateUpload. Made for people who hate the upload.
        </p>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      <ul className="mt-4 space-y-1 text-sm text-muted-foreground [&_a]:inline-flex [&_a]:min-h-9 [&_a]:items-center">
        {children}
      </ul>
    </div>
  );
}
