"use client";

import { useCallback, useRef, useState } from "react";
import { FileImage, FileText, Loader2, Upload } from "lucide-react";
import JSZip from "jszip";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  createFileItems,
  idleJob,
  type FileItem,
  type JobState,
  type ResultItem,
} from "@/lib/job";
import type { ToolDefinition, ToolId } from "@/lib/tools";
import {
  processCompressImage,
  processCompressPdf,
  processHeicToJpg,
  processImageToPdf,
  processMergePdf,
  processPdfToJpg,
  processSplitPdf,
  processWebpToJpg,
} from "@/lib/processors";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";

async function runTool(
  id: ToolId,
  files: FileItem[],
  onProgress: (ratio: number) => void,
): Promise<ResultItem[]> {
  switch (id) {
    case "heic-to-jpg":
      return processHeicToJpg(files, onProgress);
    case "compress-image":
      return processCompressImage(files, onProgress);
    case "webp-to-jpg":
      return processWebpToJpg(files, onProgress);
    case "image-to-pdf":
      return processImageToPdf(files, onProgress);
    case "merge-pdf":
      return processMergePdf(files, onProgress);
    case "split-pdf":
      return processSplitPdf(files, onProgress);
    case "pdf-to-jpg":
      return processPdfToJpg(files, onProgress);
    case "compress-pdf":
      return processCompressPdf(files, onProgress);
  }
}

async function downloadAllResults(results: ResultItem[]) {
  const zip = new JSZip();
  for (const result of results) {
    zip.file(result.name, result.blob);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "ihateupload-results.zip");
}

export function ToolWorkspace({ tool }: { tool: ToolDefinition }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<JobState>(idleJob);
  const [dragging, setDragging] = useState(false);
  const FileIcon = tool.kind === "pdf" ? FileText : FileImage;

  const files =
    job.status === "idle" ? [] : "files" in job ? job.files : [];

  const canProcess =
    job.status === "ready" &&
    (tool.id !== "merge-pdf" || job.files.length >= 2);

  const setFiles = useCallback((next: FileItem[]) => {
    if (next.length === 0) {
      setJob(idleJob());
      return;
    }
    setJob({ status: "ready", files: next });
  }, []);

  const onPick = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const items = createFileItems(list);
      setFiles(tool.multiple ? items : items.slice(0, 1));
    },
    [setFiles, tool.multiple],
  );

  const process = useCallback(async () => {
    if (job.status !== "ready") return;
    if (tool.id === "merge-pdf" && job.files.length < 2) {
      setJob({
        status: "error",
        message: "Add at least two PDF files to merge.",
        files: job.files,
      });
      return;
    }
    const current = job.files;
    setJob({ status: "processing", files: current, progress: 0 });
    try {
      const results = await runTool(tool.id, current, (ratio) => {
        setJob({
          status: "processing",
          files: current,
          progress: Math.round(ratio * 100),
        });
      });
      setJob({ status: "done", files: current, results });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while processing.";
      setJob({ status: "error", message, files: current });
    }
  }, [job, tool.id]);

  const reset = () => {
    setJob(idleJob());
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border border-ink/15 bg-card/90 p-5 shadow-[0_20px_60px_-30px_rgba(11,18,32,0.45)] sm:p-8",
          dragging && "border-signal ring-2 ring-signal/30",
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          onPick(e.dataTransfer.files);
        }}
      >
        <button
          type="button"
          className={cn(
            "flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-ink/25 bg-background/60 px-4 py-12 text-center transition-colors hover:border-signal/50 hover:bg-background",
            files.length === 0 && "animate-pulse-ring",
          )}
          onClick={() => inputRef.current?.click()}
        >
          <span className="flex size-12 items-center justify-center rounded-full bg-signal/10 text-signal">
            <Upload className="size-5" />
          </span>
          <span className="font-display text-lg font-semibold text-ink">
            Drop files here
          </span>
          <span className="max-w-sm text-sm text-muted-foreground">
            Or click to choose. Processing stays on this device. Nothing is
            uploaded.
          </span>
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={tool.accept}
          multiple={tool.multiple}
          onChange={(e) => onPick(e.target.files)}
        />

        {files.length > 0 && (
          <ul className="mt-5 space-y-2">
            {files.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-3 rounded-lg border border-ink/10 bg-background/70 px-3 py-2.5"
              >
                <FileIcon className="size-4 shrink-0 text-lagoon" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                  {file.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatBytes(file.size)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {job.status === "ready" &&
          tool.id === "merge-pdf" &&
          job.files.length < 2 && (
            <p className="mt-3 text-sm text-muted-foreground">
              Add at least two PDFs to merge.
            </p>
          )}

        {job.status === "processing" && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <Loader2 className="size-4 animate-spin text-signal" />
                Working locally…
              </span>
              <span className="text-muted-foreground">{job.progress}%</span>
            </div>
            <Progress value={job.progress} />
          </div>
        )}

        {job.status === "error" && (
          <div
            role="alert"
            className="mt-5 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {job.message}
          </div>
        )}

        {job.status === "done" && (
          <div className="mt-5 space-y-3">
            {job.results.length > 1 && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => downloadAllResults(job.results)}
                >
                  Download all
                </Button>
              </div>
            )}
            <ul className="space-y-2">
              {job.results.map((result) => (
                <li
                  key={result.id}
                  className="flex flex-col gap-2 rounded-lg border border-lagoon/25 bg-lagoon/5 px-3 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {result.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(result.originalSize)} →{" "}
                      {formatBytes(result.size)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => downloadBlob(result.blob, result.name)}
                  >
                    Download
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button size="lg" disabled={!canProcess} onClick={process}>
            {tool.actionLabel}
          </Button>
          {job.status !== "idle" && (
            <Button size="lg" variant="outline" onClick={reset}>
              Clear
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
