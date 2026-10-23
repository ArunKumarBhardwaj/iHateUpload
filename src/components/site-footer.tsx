import { ArrowRight, ArrowUp } from "lucide-react";
import Link from "next/link";

import { FooterClaims } from "@/components/footer-claims";
import { FooterWordmark } from "@/components/footer-wordmark";
import { GROUP_COLOR, groupOf } from "@/components/tool-icon";
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

// The moving strip under the headline: a spread across every category.
const TICKER: ToolId[] = [
  "compress-pdf",
  "merge-pdf",
  "pdf-to-word",
  "sign-pdf",
  "heic-to-jpg",
  "split-pdf",
  "edit-pdf",
  "excel-to-pdf",
  "redact-pdf",
  "compress-image",
  "ocr-pdf",
  "protect-pdf",
  "scan-to-pdf",
  "pdf-to-excel",
  "watermark-pdf",
  "resize-image",
];

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-auto overflow-hidden border-t border-ink/10 bg-background font-sans">
      <div className="mx-auto flex max-w-[90rem] flex-col gap-8 px-6 pt-16 pb-12 sm:flex-row sm:items-end sm:justify-between sm:pt-24">
        <h2 className="font-display max-w-3xl text-[clamp(2.5rem,6vw,5rem)] leading-[0.95] font-semibold tracking-[-0.04em] text-balance text-ink">
          Your files stay on your device.{" "}
          <span className="text-ink/55">Always.</span>
        </h2>
        <Link
          href="/tools"
          className="group pressable lift inline-flex h-12 shrink-0 items-center gap-2 self-start rounded-full bg-ink px-6 text-sm font-medium text-white sm:self-auto"
        >
          Browse all tools
          <ArrowRight
            className="size-4 transition-transform duration-200 ease-out group-hover:translate-x-0.5"
            aria-hidden
          />
        </Link>
      </div>

      <ToolTicker />

      <div className="mx-auto grid max-w-[90rem] grid-cols-2 gap-x-6 gap-y-10 px-6 py-14 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="col-span-2 max-w-xs lg:col-span-1">
          <p className="text-sm font-semibold text-ink">Private by design</p>
          <FooterClaims />
        </div>

        <FooterColumn title="Browse by category">
          {TOOL_GROUPS.map((group) => (
            <li key={group.id}>
              {/* A plain anchor so the hash change fires on the homepage too. */}
              <a href={`/#${group.id}`} className="footer-link gap-2">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: GROUP_COLOR[group.id] }}
                  aria-hidden
                />
                <span>{group.title}</span>
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
                <Link href={`/tools/${tool.slug}`} className="footer-link">
                  <span>{tool.title}</span>
                </Link>
              </li>
            );
          })}
        </FooterColumn>

        <FooterColumn title="About">
          <li>
            <Link href="/privacy" className="footer-link">
              <span>How your files stay private</span>
            </Link>
          </li>
          <li>
            <Link href="/privacy#check" className="footer-link">
              <span>Check it yourself</span>
            </Link>
          </li>
          <li>
            <Link href="/tools" className="footer-link">
              <span>All tools A to Z</span>
            </Link>
          </li>
          <li>
            <Link href="/alternatives" className="footer-link">
              <span>Compare alternatives</span>
            </Link>
          </li>
        </FooterColumn>
      </div>

      <div className="mx-auto flex max-w-[90rem] items-center justify-between gap-4 border-t border-ink/8 px-6 py-5 text-xs text-muted-foreground">
        <p>© 2026 iHateUpload. Made for people who hate the upload.</p>
        <a href="#" className="group pressable inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap hover:text-ink">
          Back to top
          <ArrowUp
            className="size-3.5 transition-transform duration-200 ease-out group-hover:-translate-y-0.5"
            aria-hidden
          />
        </a>
      </div>

      <FooterWordmark />
    </footer>
  );
}

/** Tool names drifting sideways; the list is drawn twice so the loop is seamless. */
function ToolTicker() {
  const tools = TICKER.flatMap((id) => {
    const tool = getTool(id);
    return tool ? [tool] : [];
  });
  return (
    <div className="ticker border-y border-ink/8 py-4">
      <div className="ticker-track flex w-max">
        {[0, 1].map((copy) => (
          <ul key={copy} className="flex shrink-0" aria-hidden={copy === 1 || undefined}>
            {tools.map((tool) => (
              <li key={tool.id}>
                <Link
                  href={`/tools/${tool.slug}`}
                  tabIndex={copy === 1 ? -1 : undefined}
                  className="font-display inline-flex items-center gap-3 px-5 text-2xl font-semibold tracking-[-0.02em] whitespace-nowrap text-ink/35 transition-colors duration-200 hover:text-ink sm:text-3xl"
                >
                  <span
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: GROUP_COLOR[groupOf(tool.id)?.id ?? "to-pdf"] }}
                    aria-hidden
                  />
                  {tool.title}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
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
      <ul className="mt-4 space-y-1 text-sm text-muted-foreground">{children}</ul>
    </div>
  );
}
