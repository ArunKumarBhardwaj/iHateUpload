import type { FaqItem } from "@/lib/tool-faq";

/** Visible FAQ; the same items go out as FAQPage JSON-LD, so they must match. */
export function FaqSection({ items }: { items: FaqItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="mt-20">
      <h2 className="text-balance text-3xl font-semibold text-ink sm:text-4xl">
        Frequently asked questions
      </h2>
      <div className="mt-5 divide-y divide-ink/8 rounded-[1.5rem] bg-card ring-1 ring-ink/6">
        {items.map((item) => (
          <details key={item.q} className="group px-5 py-4">
            <summary className="cursor-pointer text-[15px] font-semibold text-ink marker:text-ink/30">
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
