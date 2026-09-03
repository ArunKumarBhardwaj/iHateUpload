"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileImage, FileText, Loader2, Lock, Upload } from "lucide-react";
import JSZip from "jszip";

import { FileList } from "@/components/workbench/file-list";
import {
  OptionsPanel,
  optionsHint,
  optionsNeedCanvas,
} from "@/components/workbench/options-panel";
import { ResultPanel } from "@/components/workbench/result-panel";
import { Stepper } from "@/components/workbench/stepper";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { continueToolsFor } from "@/lib/continue-map";
import { setHandoff, takeHandoff } from "@/lib/handoff";
import {
  createFileItems,
  idleJob,
  type FileItem,
  type JobState,
  type ResultItem,
} from "@/lib/job";
import {
  initialOptions,
  optionsReady,
  type ToolOptions,
} from "@/lib/tool-options";
import type { ToolDefinition, ToolId } from "@/lib/tools";
import {
  processCompressImage,
  processCompressPdf,
  processExtractPages,
  processHeicToJpg,
  processHeicToPdf,
  processImageToPdf,
  processJpgToPng,
  processMergePdf,
  processOrganizePdf,
  processPdfToJpg,
  processPngToJpg,
  processProtectPdf,
  processResizeImage,
  processRotatePdf,
  processSplitPdf,
  processUnlockPdf,
  processWebpToJpg,
} from "@/lib/processors";
import { useFilePreviews, usePagePreviews } from "@/lib/use-previews";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";

async function runTool(
  id: ToolId,
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
): Promise<ResultItem[]> {
  switch (id) {
    case "heic-to-jpg":
      return processHeicToJpg(files, onProgress);
    case "heic-to-pdf":
      return processHeicToPdf(files, onProgress);
    case "compress-image":
      return processCompressImage(files, onProgress);
    case "resize-image":
      return processResizeImage(files, onProgress, options);
    case "webp-to-jpg":
      return processWebpToJpg(files, onProgress);
    case "png-to-jpg":
      return processPngToJpg(files, onProgress);
    case "jpg-to-png":
      return processJpgToPng(files, onProgress);
    case "image-to-pdf":
      return processImageToPdf(files, onProgress);
    case "merge-pdf":
      return processMergePdf(files, onProgress);
    case "split-pdf":
      return processSplitPdf(files, onProgress);
    case "extract-pages":
      return processExtractPages(files, onProgress, options);
    case "pdf-to-jpg":
      return processPdfToJpg(files, onProgress);
    case "compress-pdf":
      return processCompressPdf(files, onProgress, options);
    case "protect-pdf":
      return processProtectPdf(files, onProgress, options);
    case "unlock-pdf":
      return processUnlockPdf(files, onProgress, options);
    case "rotate-pdf":
      return processRotatePdf(files, onProgress, options);
    case "organize-pdf":
      return processOrganizePdf(files, onProgress, options);
  }
}

function downloadLabel(results: ResultItem[]) {
  if (results.length !== 1) return `Download all (${results.length})`;
  const type = results[0].blob.type;
  if (type.includes("pdf")) return "Download PDF";
  if (type.includes("png")) return "Download PNG";
  if (type.includes("jpeg") || type.includes("jpg")) return "Download JPG";
  if (type.includes("zip")) return "Download zip";
  return "Download file";
}

function jobAnnouncement(job: JobState): string {
  switch (job.status) {
    case "processing":
      return `Working locally, ${job.progress} percent.`;
    case "done":
      return job.results.length === 1
        ? "1 file is ready to download."
        : `${job.results.length} files are ready to download.`;
    case "error":
      return job.message;
    default:
      return "";
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

/** Stable identity so the preview hook does not restart on every render. */
const NO_FILES: FileItem[] = [];

export function ToolWorkspace({ tool }: { tool: ToolDefinition }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<JobState>(idleJob);
  const [dragging, setDragging] = useState(false);
  const [options, setOptions] = useState<ToolOptions>(() =>
    initialOptions(tool.ui),
  );
  const [confirmPassword, setConfirmPassword] = useState("");

  const files = job.status === "idle" ? NO_FILES : job.files;
  const previews = useFilePreviews(files, tool.kind);

  const pagedFile =
    options.kind === "organize" || options.kind === "extract"
      ? files[0]
      : undefined;
  const pagedFacts = pagedFile ? previews.get(pagedFile.id)?.facts : undefined;
  const pageCount = pagedFacts?.kind === "pdf" ? pagedFacts.pages : 0;
  const organizeFile = options.kind === "organize" ? pagedFile : undefined;
  const pagePreviews = usePagePreviews(organizeFile, pageCount);

  const setFiles = useCallback((next: FileItem[]) => {
    setJob(next.length === 0 ? idleJob() : { status: "ready", files: next });
  }, []);

  /**
   * The handoff is a one-shot module value the previous tool left behind. It
   * only exists on the client, so reading it in a state initialiser would
   * render files the server never sent and break hydration.
   */
  useEffect(() => {
    const handoff = takeHandoff();
    if (!handoff) return;
    const items = createFileItems(handoff.files);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    setFiles(tool.multiple ? items : items.slice(0, 1));
  }, [tool.multiple, setFiles]);

  /**
   * A new document resets the page order to its natural sequence. Adjusting
   * during render rather than in an effect means the grid never paints one
   * frame of the previous document's order.
   */
  const pageKey = `${pagedFile?.id ?? ""}:${pageCount}`;
  const [orderedKey, setOrderedKey] = useState(pageKey);
  if (options.kind === "organize" && orderedKey !== pageKey) {
    setOrderedKey(pageKey);
    setOptions({
      kind: "organize",
      pageOrder: Array.from({ length: pageCount }, (_, index) => index),
    });
  }
  if (options.kind === "extract" && orderedKey !== pageKey) {
    setOrderedKey(pageKey);
    setOptions({
      kind: "extract",
      range: pageCount > 0 ? `1-${pageCount}` : "",
      pageCount,
    });
  }

  const addFiles = useCallback(
    (list: FileList | null, mode: "replace" | "append") => {
      if (!list || list.length === 0) return;
      const picked = createFileItems(list);
      if (!tool.multiple) {
        setFiles(picked.slice(0, 1));
        return;
      }
      setFiles(mode === "append" ? [...files, ...picked] : picked);
    },
    [files, setFiles, tool.multiple],
  );

  const busy = job.status === "processing";
  const settled = job.status === "ready" || job.status === "error";
  const locked = busy || job.status === "done";
  const reorderable = tool.ordered && tool.multiple;
  const enoughFiles = tool.id !== "merge-pdf" || files.length >= 2;
  const canProcess =
    settled && enoughFiles && optionsReady(options, confirmPassword);

  const process = useCallback(async () => {
    if (job.status !== "ready" && job.status !== "error") return;
    const current = job.files;
    if (tool.id === "merge-pdf" && current.length < 2) {
      setJob({
        status: "error",
        message: "Add at least two PDF files to merge.",
        files: current,
      });
      return;
    }
    setJob({ status: "processing", files: current, progress: 0 });
    try {
      const results = await runTool(
        tool.id,
        current,
        (ratio) => {
          setJob({
            status: "processing",
            files: current,
            progress: Math.round(ratio * 100),
          });
        },
        options,
      );
      setJob({ status: "done", files: current, results });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while processing.";
      setJob({ status: "error", message, files: current });
    }
  }, [job, tool.id, options]);

  const reset = () => {
    setJob(idleJob());
    setOptions(initialOptions(tool.ui));
    setConfirmPassword("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const continueWith = (next: ToolDefinition) => {
    if (job.status !== "done") return;
    const handoffFiles = job.results.map(
      (result) =>
        new File([result.blob], result.name, {
          type: result.blob.type || "application/octet-stream",
        }),
    );
    setHandoff({ files: handoffFiles, from: tool.id });
    router.push(`/tools/${next.slug}`);
  };

  const moveFile = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= files.length) return;
    const next = [...files];
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next);
  };

  const optionsInCanvas = optionsNeedCanvas(options);
  const optionsPanel = (
    <OptionsPanel
      options={options}
      onOptions={setOptions}
      confirmPassword={confirmPassword}
      onConfirmPassword={setConfirmPassword}
      pagePreviews={pagePreviews}
      pageCount={pageCount}
      disabled={locked}
    />
  );

  const SourceIcon = tool.kind === "pdf" ? FileText : FileImage;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div
        className={cn(
          // No `overflow-hidden` here: it would stop the action bar sticking.
          "relative rounded-2xl border border-ink/15 bg-card/90 p-5 shadow-[0_20px_60px_-30px_rgba(11,18,32,0.45)] sm:p-8",
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
          if (locked) return;
          addFiles(e.dataTransfer.files, settled ? "append" : "replace");
        }}
      >
        <div className="mb-5">
          <Stepper job={job} options={options} />
        </div>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {jobAnnouncement(job)}
        </p>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={tool.accept}
          multiple={tool.multiple}
          onChange={(e) => {
            addFiles(e.target.files, settled ? "append" : "replace");
            e.target.value = "";
          }}
        />

        {job.status === "idle" && (
          <button
            type="button"
            className="flex w-full animate-pulse-ring flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-ink/25 bg-background/60 px-4 py-14 text-center transition-colors hover:border-signal/50 hover:bg-background"
            onClick={() => inputRef.current?.click()}
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-signal/10 text-signal">
              <Upload className="size-6" />
            </span>
            <span className="inline-flex h-12 items-center rounded-lg bg-primary px-6 font-display text-base font-semibold text-primary-foreground">
              {tool.multiple ? "Select files" : "Select a file"}
            </span>
            <span className="max-w-sm text-sm text-muted-foreground">
              Or drop {tool.kind === "pdf" ? "PDFs" : "images"} here. We refuse
              the upload, so the work happens in this tab.
            </span>
          </button>
        )}

        {(settled || busy) && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 space-y-5">
              {optionsInCanvas ? (
                <div className="flex items-center gap-3 rounded-xl border border-ink/10 bg-background/70 px-3 py-2.5">
                  <SourceIcon className="size-4 shrink-0 text-lagoon" />
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
                    title={files[0]?.name}
                  >
                    {files[0]?.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {files[0] ? formatBytes(files[0].size) : null}
                  </span>
                </div>
              ) : (
                <FileList
                  tool={tool}
                  files={files}
                  previews={previews}
                  reorderable={reorderable}
                  disabled={locked}
                  onAddMore={() => inputRef.current?.click()}
                  onSortByName={() =>
                    setFiles(
                      [...files].sort((a, b) =>
                        a.name.localeCompare(b.name, undefined, {
                          numeric: true,
                        }),
                      ),
                    )
                  }
                  onMove={moveFile}
                  onRemove={(id) =>
                    setFiles(files.filter((file) => file.id !== id))
                  }
                />
              )}
              {optionsInCanvas && optionsPanel}
            </div>

            <aside className="space-y-4 lg:border-l lg:border-ink/10 lg:pl-6">
              <div>
                <h2 className="font-display text-lg font-semibold text-ink">
                  {options.kind === "none" ? "Ready to run" : "Settings"}
                </h2>
                <div className="mt-2 space-y-2 rounded-lg border border-lagoon/20 bg-lagoon/5 px-3 py-2.5 text-sm text-muted-foreground">
                  <p>{optionsHint(options, tool.actionLabel)}</p>
                  {reorderable && files.length > 1 && (
                    <p>Output follows the order of the cards.</p>
                  )}
                  {tool.id === "merge-pdf" && files.length < 2 && (
                    <p className="font-medium text-ink">
                      Add at least two PDFs to merge.
                    </p>
                  )}
                </div>
              </div>

              {!optionsInCanvas && optionsPanel}

              {job.status === "error" && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {job.message}
                </div>
              )}
            </aside>
          </div>
        )}

        {job.status === "done" && (
          <ResultPanel
            results={job.results}
            continueTargets={continueToolsFor(
              tool.id,
              job.results.map((result) => ({ type: result.blob.type })),
            )}
            onContinue={continueWith}
          />
        )}

        {job.status !== "idle" && (
          <div className="sticky bottom-0 -mx-5 -mb-5 mt-6 rounded-b-2xl border-t border-ink/10 bg-card/95 px-5 pb-5 pt-4 backdrop-blur sm:-mx-8 sm:-mb-8 sm:px-8 sm:pb-8">
            {job.status === "processing" && (
              <div className="mb-3 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="inline-flex items-center gap-2 font-medium text-ink">
                    <Loader2 className="size-4 animate-spin text-signal" />
                    Working locally…
                  </span>
                  <span className="text-muted-foreground">{job.progress}%</span>
                </div>
                <Progress
                  value={job.progress}
                  aria-label="Processing"
                  aria-valuetext={`${job.progress} percent`}
                />
              </div>
            )}
            <p className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3" />
              Runs in this tab. Nothing is uploaded.
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="lg"
                variant="outline"
                className="h-12"
                disabled={busy}
                onClick={reset}
              >
                Start over
              </Button>
              {job.status === "done" ? (
                <Button
                  size="lg"
                  className="h-12 flex-1 px-6 text-base sm:flex-none"
                  onClick={() => {
                    if (job.results.length === 1) {
                      downloadBlob(job.results[0].blob, job.results[0].name);
                      return;
                    }
                    void downloadAllResults(job.results);
                  }}
                >
                  <Download />
                  {downloadLabel(job.results)}
                </Button>
              ) : (
                <Button
                  size="lg"
                  className="h-12 flex-1 px-6 text-base sm:flex-none"
                  disabled={!canProcess}
                  onClick={process}
                >
                  {tool.actionLabel}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
