import Link from "next/link";

import type { CompareRow, Verdict } from "@/lib/seo/alternatives";
import { cn } from "@/lib/utils";

const VERDICT_LABEL: Record<Verdict, string> = {
  better: "iHateUpload ahead",
  equal: "Even",
  gap: "ihatepdf.cv ahead",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={cn(
        "inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold",
        verdict === "better" && "bg-signal/10 text-signal-ink",
        verdict === "equal" && "bg-ink/5 text-ink",
        verdict === "gap" && "bg-ink/10 text-ink",
      )}
    >
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

/** Stacked cards rather than a wide table, so it reads at phone width. */
export function CompareList({ rows }: { rows: CompareRow[] }) {
  return (
    <ul className="mt-5 grid gap-3 lg:grid-cols-2">
      {rows.map((row) => (
        <li
          key={row.feature}
          className="rounded-2xl border border-ink/8 bg-card p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="text-base font-semibold text-ink">
              {row.slug ? (
                <Link
                  href={`/alternatives/ihatepdf/${row.slug}`}
                  className="underline decoration-ink/20 underline-offset-4 hover:decoration-ink"
                >
                  {row.feature}
                </Link>
              ) : (
                row.feature
              )}
            </h3>
            <VerdictBadge verdict={row.verdict} />
          </div>
          <dl className="mt-3 grid gap-2 text-sm leading-relaxed">
            <div>
              <dt className="font-medium text-ink">iHateUpload</dt>
              <dd className="text-muted-foreground">{row.ours}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">ihatepdf.cv</dt>
              <dd className="text-muted-foreground">{row.theirs}</dd>
            </div>
            <div>
              <dt className="font-medium text-ink">How we checked</dt>
              <dd className="text-muted-foreground">
                {row.evidence} Checked {row.checked}.
              </dd>
            </div>
          </dl>
        </li>
      ))}
    </ul>
  );
}
