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
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "group flex flex-col rounded-2xl border border-ink/8 bg-card p-5 shadow-[0_1px_0_rgba(20,22,28,0.04)] transition-colors hover:border-signal/40 hover:shadow-[0_10px_28px_-18px_rgba(20,22,28,0.45)]",
        compact && "p-4",
      )}
    >
      <ToolIcon
        id={tool.id}
        className={compact ? "size-10 rounded-xl" : "size-12 rounded-2xl"}
        iconClassName={compact ? "size-5" : "size-6"}
      />
      <span className="mt-4 text-[15px] font-semibold text-ink group-hover:text-signal">
        {tool.title}
      </span>
      <span className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
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
        "grid gap-3 sm:grid-cols-2 md:grid-cols-3",
        compact ? "lg:grid-cols-3" : "lg:grid-cols-4",
      )}
    >
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} compact={compact} />
      ))}
    </div>
  );
}
