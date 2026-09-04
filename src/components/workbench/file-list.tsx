"use client";

import {
  ArrowDown,
  ArrowDownAZ,
  ArrowUp,
  FileImage,
  FileText,
  Plus,
  X,
} from "lucide-react";

import { Thumbnail } from "@/components/workbench/thumbnail";
import { Button } from "@/components/ui/button";
import type { FileItem } from "@/lib/job";
import {
  PENDING_PREVIEW,
  UNAVAILABLE_PREVIEW,
  type FileFacts,
  type FilePreview,
} from "@/lib/preview";
import type { ToolDefinition } from "@/lib/tools";
import { FILE_THUMBNAIL_LIMIT } from "@/lib/use-previews";
import { cn, formatBytes } from "@/lib/utils";

/**
 * Phones get the wider hit area the platform guidelines ask for; pointer
 * layouts keep the compact one. Three 40px buttons plus gaps are the most a
 * two-column card fits at 390px wide, which is where 44px stops being an option.
 */
const TOOLBAR_BUTTON = "h-10 sm:h-7";
const CARD_BUTTON = "size-10 sm:size-9";

function factsLabel(facts: FileFacts | null): string | null {
  if (!facts) return null;
  switch (facts.kind) {
    case "pdf":
      return facts.pages === 1 ? "1 page" : `${facts.pages} pages`;
    case "image":
      return `${facts.width} × ${facts.height}`;
  }
}

export function FileList({
  tool,
  files,
  previews,
  reorderable,
  disabled,
  onAddMore,
  onSortByName,
  onMove,
  onRemove,
}: {
  tool: ToolDefinition;
  files: FileItem[];
  previews: ReadonlyMap<string, FilePreview>;
  reorderable: boolean;
  disabled: boolean;
  onAddMore: () => void;
  onSortByName: () => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
}) {
  const Icon = tool.kind === "pdf" ? FileText : FileImage;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {files.length === 1 ? "1 file" : `${files.length} files`}
          <span className="text-muted-foreground">
            {" · "}
            {formatBytes(totalBytes)}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          {reorderable && files.length > 1 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={TOOLBAR_BUTTON}
              disabled={disabled}
              onClick={onSortByName}
            >
              <ArrowDownAZ />
              Sort A to Z
            </Button>
          )}
          {tool.multiple && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={TOOLBAR_BUTTON}
              disabled={disabled}
              onClick={onAddMore}
            >
              <Plus />
              Add more
            </Button>
          )}
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {files.map((file, index) => {
          const preview =
            previews.get(file.id) ??
            (index < FILE_THUMBNAIL_LIMIT
              ? PENDING_PREVIEW
              : UNAVAILABLE_PREVIEW);
          const caption = [factsLabel(preview.facts), formatBytes(file.size)]
            .filter((part) => part !== null)
            .join(" · ");

          return (
          <li
            key={file.id}
            className="flex flex-col gap-2 rounded-xl border border-ink/10 bg-background p-2.5"
          >
            <Thumbnail
              state={preview.thumbnail}
              alt={`Preview of ${file.name}`}
              icon={<Icon className="size-5" />}
              className="h-36 w-full bg-muted/40 sm:h-40"
            />
            <div className="min-w-0">
              <p
                className="truncate text-xs font-medium text-ink"
                title={file.name}
              >
                {file.name}
              </p>
              <p className="text-[11px] text-muted-foreground">{caption}</p>
            </div>
            <div className="flex items-center gap-1">
              {reorderable && files.length > 1 && (
                <>
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    className={CARD_BUTTON}
                    aria-label={`Move ${file.name} earlier`}
                    disabled={disabled || index === 0}
                    onClick={() => onMove(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="outline"
                    className={CARD_BUTTON}
                    aria-label={`Move ${file.name} later`}
                    disabled={disabled || index === files.length - 1}
                    onClick={() => onMove(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                </>
              )}
              <Button
                type="button"
                size="icon-lg"
                variant="outline"
                className={cn(CARD_BUTTON, "ml-auto")}
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onRemove(file.id)}
              >
                <X />
              </Button>
            </div>
          </li>
          );
        })}
      </ul>

      {files.length > FILE_THUMBNAIL_LIMIT && (
        <p className="text-xs text-muted-foreground">
          Showing previews for the first {FILE_THUMBNAIL_LIMIT} files. All{" "}
          {files.length} still get processed.
        </p>
      )}
    </div>
  );
}
