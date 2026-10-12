"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CloudOff, Lock, Upload } from "lucide-react";

import { FormatTile, ToolIcon, type Format } from "@/components/tool-icon";
import { Button } from "@/components/ui/button";
import { toolsForFiles } from "@/lib/file-match";
import { setHandoff } from "@/lib/handoff";
import type { ToolDefinition } from "@/lib/tools";
import { cn, formatBytes } from "@/lib/utils";

const FIRST_LOOK = 6;

// Decorative tiles around the window: the kinds of files that fit.
const FLOATING: { format: Format; className: string }[] = [
  { format: "pdf", className: "-top-7 -left-9 -rotate-12" },
  { format: "word", className: "top-32 -left-16 rotate-6" },
  { format: "jpg", className: "-top-9 -right-7 rotate-12" },
  { format: "excel", className: "-right-14 top-40 -rotate-6" },
  { format: "heic", className: "-bottom-8 left-24 rotate-3" },
  { format: "ppt", className: "-right-9 -bottom-7 rotate-12" },
];

function describe(files: File[]) {
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const label = files.length === 1 ? files[0].name : `${files.length} files`;
  return `${label} · ${formatBytes(total)}`;
}

/**
 * The homepage works backwards from the file: drop anything, see the jobs
 * that fit, pick one. Files stay in memory and ride the same handoff the
 * "Continue with" chips use, so nothing is read or uploaded until a tool runs.
 */
export function HomeDrop() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const matches = useMemo(() => toolsForFiles(files), [files]);
  const shown = showAll ? matches : matches.slice(0, FIRST_LOOK);

  const take = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles(Array.from(list));
    setShowAll(false);
  };

  // Dropping anywhere on the page lands here instead of opening the file.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const dropped = event.dataTransfer?.files;
      if (!dropped || dropped.length === 0) return;
      setFiles(Array.from(dropped));
      setShowAll(false);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const open = (tool: ToolDefinition) => {
    setHandoff({ files, from: "home" });
    router.push(`/tools/${tool.slug}`);
  };

  return (
    <div className="relative">
      {FLOATING.map(({ format, className }) => (
        <FormatTile
          key={format}
          format={format}
          className={cn(
            "absolute z-10 hidden shadow-[0_12px_24px_-12px_rgba(20,22,28,0.45)] ring-4 ring-white md:flex",
            className,
          )}
        />
      ))}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border bg-card shadow-[0_30px_60px_-30px_rgba(20,22,28,0.35)] transition-colors",
          dragging ? "border-signal ring-4 ring-signal/15" : "border-ink/10",
        )}
      >
        <div className="flex h-11 items-center gap-3 border-b border-ink/8 bg-surface px-4">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#ff5f57]" />
            <span className="size-2.5 rounded-full bg-[#febc2e]" />
            <span className="size-2.5 rounded-full bg-[#28c840]" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md bg-card px-2.5 py-1 text-xs text-muted-foreground">
            <Lock className="size-3 shrink-0" aria-hidden />
            <span className="truncate">ihateupload.com</span>
          </span>
          <span className="hidden items-center gap-1 text-xs font-medium text-lagoon sm:flex">
            <CloudOff className="size-3.5" aria-hidden />
            No upload
          </span>
        </div>
        <div className="p-5 sm:p-6">
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Choose files to work on"
            onChange={(event) => {
              take(event.target.files);
              event.target.value = "";
            }}
          />

          {files.length === 0 ? (
            <div
              className={cn(
                "flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-10 text-center transition-colors sm:py-14",
                dragging
                  ? "border-signal bg-signal/5"
                  : "border-ink/12 bg-surface/60",
              )}
            >
              <span className="flex size-14 items-center justify-center rounded-full bg-signal text-white shadow-[0_10px_24px_-10px_rgba(214,31,58,0.8)]">
                <Upload className="size-6" aria-hidden />
              </span>
              <p className="mt-4 text-lg font-semibold text-ink">
                {dragging ? "Let go to see what fits" : "Drop your files here"}
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                PDF, JPG, PNG, HEIC, Word, Excel, or PowerPoint. We show the
                tools that fit.
              </p>
              <Button
                type="button"
                size="lg"
                className="mt-6 min-h-12 px-7 text-base"
                onClick={() => inputRef.current?.click()}
              >
                Choose files
              </Button>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between gap-3">
                <p
                  className="min-w-0 truncate text-sm font-medium text-ink"
                  title={describe(files)}
                >
                  {describe(files)}
                </p>
                <button
                  type="button"
                  className="shrink-0 text-sm font-medium text-signal-ink underline-offset-4 hover:underline"
                  onClick={() => inputRef.current?.click()}
                >
                  Change
                </button>
              </div>

              {matches.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  Nothing here opens this kind of file yet. Try a PDF, JPG, PNG,
                  WebP, HEIC, Word, Excel, or PowerPoint file.
                </p>
              ) : (
                <>
                  <p className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    What do you want to do?
                  </p>
                  <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                    {shown.map((tool) => (
                      <li key={tool.id}>
                        <button
                          type="button"
                          onClick={() => open(tool)}
                          className="group flex min-h-12 w-full items-center gap-3 rounded-xl border border-ink/8 px-3 py-2 text-left transition-colors hover:border-signal/40 hover:bg-signal/5"
                        >
                          <ToolIcon
                            id={tool.id}
                            className="size-8 shrink-0 rounded-lg"
                            iconClassName="size-4"
                          />
                          <span className="min-w-0 flex-1 text-sm font-semibold text-ink">
                            {tool.shortTitle}
                          </span>
                          <ArrowRight
                            className="size-4 shrink-0 text-ink/30 transition-transform group-hover:translate-x-0.5 group-hover:text-signal-ink"
                            aria-hidden
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {matches.length > FIRST_LOOK && !showAll ? (
                    <button
                      type="button"
                      className="mt-3 text-sm font-medium text-signal-ink underline-offset-4 hover:underline"
                      onClick={() => setShowAll(true)}
                    >
                      All {matches.length} tools for this file
                    </button>
                  ) : null}
                </>
              )}
              <p className="mt-4 text-xs text-muted-foreground">
                Your file stays in this tab. Nothing is read until a tool runs.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
