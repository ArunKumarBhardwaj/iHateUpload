import type { FaqItem } from "@/lib/tool-faq";

/** Visible FAQ; the same items go out as FAQPage JSON-LD, so they must match. */
export function FaqSection({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-12">
      <h2 className="text-balance text-2xl font-semibold text-ink">
        Frequently asked questions
      </h2>
      <div className="mt-5 divide-y divide-ink/8 rounded-2xl border border-ink/8 bg-card">
        {items.map((item) => (
          <details key={item.q} className="p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              {item.q}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
