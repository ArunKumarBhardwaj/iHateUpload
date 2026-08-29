import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="relative z-10 mt-auto border-t border-ink/10 bg-card/50">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>
          <span className="font-medium text-ink">iHateUpload</span>
          {" · "}
          Files stay in your browser. No server processing.
        </p>
        <div className="flex gap-4">
          <Link href="/privacy" className="hover:text-ink">
            Privacy
          </Link>
          <Link href="/#tools" className="hover:text-ink">
            Tools
          </Link>
        </div>
      </div>
    </footer>
  );
}
