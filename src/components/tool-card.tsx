import Link from "next/link";

import { ToolIcon } from "@/components/tool-icon";
import type { ToolDefinition } from "@/lib/tools";
import { cn } from "@/lib/utils";

export function ToolCard({
  tool,
  compact = false,
}: {
  tool: ToolDefinition;
  compact?: boolean;
}) {
  // Below sm the card collapses to an icon + title row so the 2-column mobile
  // grid stays short; sm and up keep the full card.
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "group flex min-h-12 flex-row items-center gap-2.5 rounded-xl border border-ink/8 bg-card p-2.5 shadow-[0_1px_0_rgba(20,22,28,0.04)] transition-colors hover:border-signal/40 hover:shadow-[0_10px_28px_-18px_rgba(20,22,28,0.45)] sm:flex-col sm:items-stretch sm:gap-0 sm:rounded-2xl sm:p-5",
        compact && "sm:p-4",
      )}
    >
      <ToolIcon
        id={tool.id}
        className={cn(
          "size-8 shrink-0 rounded-lg",
          compact ? "sm:size-10 sm:rounded-xl" : "sm:size-12 sm:rounded-2xl",
        )}
        iconClassName={compact ? "size-4 sm:size-5" : "size-4 sm:size-6"}
      />
      <span className="min-w-0 text-sm leading-tight font-semibold text-ink group-hover:text-signal-ink sm:mt-4 sm:text-[15px]">
        {tool.title}
      </span>
      <span className="mt-1 line-clamp-2 hidden text-sm leading-snug text-muted-foreground sm:block">
        {tool.description}
      </span>
    </Link>
  );
}

export function ToolCardGrid({
  tools,
  compact,
}: {
  tools: readonly ToolDefinition[];
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-3",
        compact ? "lg:grid-cols-3" : "lg:grid-cols-4",
      )}
    >
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} compact={compact} />
      ))}
    </div>
  );
}
