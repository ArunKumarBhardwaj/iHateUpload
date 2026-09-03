import Link from "next/link";
import { ChevronRight } from "lucide-react";

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
        "group flex items-start gap-3 rounded-2xl border border-ink/8 bg-card p-4 transition-colors hover:border-signal/30 hover:bg-signal/[0.03]",
        compact && "rounded-xl p-3",
      )}
    >
      <ToolIcon
        id={tool.id}
        className={compact ? "size-9 rounded-lg" : undefined}
        iconClassName={compact ? "size-4" : undefined}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-bold text-ink group-hover:text-signal">
          {tool.title}
        </span>
        <span className="mt-1 line-clamp-2 block text-sm leading-snug text-muted-foreground">
          {tool.description}
        </span>
      </span>
      <ChevronRight className="mt-1 size-4 shrink-0 text-ink/25 transition-transform group-hover:translate-x-0.5 group-hover:text-signal" />
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
        "grid gap-3 sm:grid-cols-2",
        compact ? "lg:grid-cols-2" : "lg:grid-cols-3",
      )}
    >
      {tools.map((tool) => (
        <ToolCard key={tool.id} tool={tool} compact={compact} />
      ))}
    </div>
  );
}
