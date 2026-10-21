"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileImage, FileText, Loader2, Lock, Upload } from "lucide-react";
import JSZip from "jszip";

import { AskChat } from "@/components/workbench/ask-chat";
import { ScanStudio } from "@/components/workbench/scan-studio";
import { FileList } from "@/components/workbench/file-list";
import {
  OptionsPanel,
  optionsHint,
  optionsNeedCanvas,
} from "@/components/workbench/options-panel";
import { CsvPreview } from "@/components/workbench/csv-preview";
import { ExtractImagesGrid } from "@/components/workbench/extract-images-grid";
import { ImageCropOverlay } from "@/components/workbench/image-crop-overlay";
import { SignCanvas } from "@/components/workbench/sign-canvas";
import { FillFormCanvas } from "@/components/workbench/fill-form-canvas";
import { PdfEditCanvas } from "@/components/workbench/pdf-edit-canvas";
import { ComparePreview } from "@/components/workbench/compare-preview";
import { RedactOverlay } from "@/components/workbench/redact-overlay";
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
import type { ToolDefinition } from "@/lib/tools";
import { shouldWarnLargeJob } from "@/lib/device-caps";
import { runTool } from "@/lib/run-tool";
import { isWorkflowTool } from "@/lib/workflow/catalog";
import { shareFragment } from "@/lib/workflow/share";
import type { FileFacts } from "@/lib/preview";
import { TOOL_GROUPS } from "@/lib/tool-groups";
import { useFilePreviews } from "@/lib/use-previews";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";


function downloadLabel(results: ResultItem[]) {
  if (results.length !== 1) return `Download all (${results.length})`;
  const type = results[0].blob.type;
  if (type.includes("pdf")) return "Download PDF";
  if (type.includes("png")) return "Download PNG";
  if (type.includes("jpeg") || type.includes("jpg")) return "Download JPG";
  if (type.includes("zip")) return "Download zip";
  if (type.includes("wordprocessingml")) return "Download Word file";
  if (type.includes("presentationml")) return "Download PowerPoint file";
  if (type.includes("text")) return "Download text";
  return "Download file";
}

/** Tools whose whole point is a smaller file, so a saving is worth showing. */
const SHRINK_TOOLS = new Set<string>(
  TOOL_GROUPS.find((group) => group.id === "smaller")?.tools ?? [],
);

function dropLabel(tool: ToolDefinition) {
  if (tool.accept.includes("docx")) return "Word files";
  if (tool.accept.includes("xlsx") || tool.accept.includes(".xls")) {
    return "spreadsheets";
  }
  if (tool.accept.includes("pptx")) return "PowerPoint files";
  if (tool.accept.includes(".md")) return "Markdown files";
  if (tool.accept.includes(".csv")) return "CSV files";
  if (tool.accept.includes(".html")) return "HTML files";
  if (tool.id === "scan-to-pdf") return "photos";
  return tool.kind === "pdf" ? "PDFs" : "images";
}

function jobAnnouncement(job: JobState): string {
  switch (job.status) {
    case "processing":
      return `Working locally, ${job.progress} percent.`;
    case "done":
      return job.results.some((result) => result.previewText)
        ? "The text is ready."
        : job.results.length === 1
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

function pdfPageCount(facts: FileFacts | null | undefined) {
  return facts?.kind === "pdf" ? facts.pages : 0;
}

export function ToolWorkspace({
  tool,
  preset,
}: {
  tool: ToolDefinition;
  /** Landing pages start the tool with options already chosen. */
  preset?: ToolOptions;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<JobState>(idleJob);
  const [dragging, setDragging] = useState(false);
  const [options, setOptions] = useState<ToolOptions>(
    () => preset ?? initialOptions(tool.ui),
  );
  const [confirmPassword, setConfirmPassword] = useState("");

  const files = job.status === "idle" ? NO_FILES : job.files;
  const previews = useFilePreviews(files, tool.kind);

  const pagedFile =
    options.kind === "organize" ||
    options.kind === "extract" ||
    options.kind === "sign" ||
    options.kind === "fill-form" ||
    options.kind === "edit" ||
    options.kind === "crop" ||
    options.kind === "redact" ||
    options.kind === "insert-blank" ||
    options.kind === "ocr"
      ? files[0]
      : undefined;
  const pagedFacts = pagedFile ? previews.get(pagedFile.id)?.facts : undefined;
  const pageCount = pagedFacts?.kind === "pdf" ? pagedFacts.pages : 0;

  const setFiles = useCallback((next: FileItem[]) => {
    setJob(next.length === 0 ? idleJob() : { status: "ready", files: next });
  }, []);

  /** PDF to Excel: fetch its code and start pdf.js while the person is still choosing options. */
  useEffect(() => {
    if (tool.id !== "pdf-to-excel") return;
    void import("@/lib/pdf-to-excel/process").then((m) => m.warmUp());
  }, [tool.id]);

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
      entries: Array.from({ length: pageCount }, (_, index) => ({
        id: `p${index}`,
        src: index,
        turn: 0 as const,
      })),
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
  const editFileId =
    options.kind === "edit" || options.kind === "sign" ? (pagedFile?.id ?? "") : "";
  const [editKey, setEditKey] = useState(editFileId);
  if (options.kind === "edit" && editKey !== editFileId) {
    setEditKey(editFileId);
    setOptions({ kind: "edit", marks: [] });
  }
  if (options.kind === "sign" && editKey !== editFileId) {
    setEditKey(editFileId);
    setOptions({ kind: "sign", placements: [] });
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
  const needsPair =
    tool.id === "merge-pdf" ||
    tool.id === "compare-pdfs" ||
    tool.id === "alternate-mix";
  const enoughFiles = !needsPair || files.length >= 2;
  const canProcess =
    settled && enoughFiles && optionsReady(options, confirmPassword);

  const process = useCallback(async () => {
    if (job.status !== "ready" && job.status !== "error") return;
    const current = job.files;
    if (needsPair && current.length < 2) {
      setJob({
        status: "error",
        message:
          tool.id === "compare-pdfs"
            ? "Add two PDFs to compare."
            : tool.id === "alternate-mix"
              ? "Add at least two PDFs to mix."
              : "Add at least two PDF files to merge.",
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
  }, [job, tool.id, options, needsPair]);

  const reset = () => {
    setJob(idleJob());
    setOptions(preset ?? initialOptions(tool.ui));
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

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const largeJob = shouldWarnLargeJob(totalBytes, pageCount);

  const overlayFile =
    (options.kind === "sign" ||
      options.kind === "fill-form" ||
      options.kind === "edit" ||
      options.kind === "redact") &&
    pagedFile
      ? pagedFile.file
      : undefined;

  const optionsPanel = (
    <OptionsPanel
      options={options}
      onOptions={setOptions}
      confirmPassword={confirmPassword}
      onConfirmPassword={setConfirmPassword}
      pageCount={pageCount}
      firstPage={files[0] ? previews.get(files[0].id)?.thumbnail : undefined}
      files={files}
      filePages={files.map((file) => pdfPageCount(previews.get(file.id)?.facts))}
      disabled={locked}
      onAddFiles={(next) => {
        const items = createFileItems(next);
        setFiles(tool.multiple ? [...files, ...items] : items.slice(0, 1));
      }}
    />
  );

  const SourceIcon = tool.kind === "pdf" ? FileText : FileImage;

  return (
    <div className="w-full">
      <div
        className={cn(
          // No `overflow-hidden` here: it would stop the action bar sticking.
          "relative rounded-2xl border border-ink/10 bg-card p-5 shadow-[0_18px_40px_-24px_rgba(20,22,28,0.28)] sm:p-8",
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
          aria-label="Choose files"
          className="sr-only"
          accept={tool.accept}
          multiple={tool.multiple}
          onChange={(e) => {
            addFiles(e.target.files, settled ? "append" : "replace");
            e.target.value = "";
          }}
        />

        {job.status === "idle" && (
          <div
            className={
              options.kind === "scan"
                ? "grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]"
                : undefined
            }
          >
            <button
              type="button"
              className="flex w-full flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed border-ink/15 bg-background px-4 py-16 text-center transition-colors hover:border-signal/40 hover:bg-signal/[0.03] sm:py-20"
              onClick={() => inputRef.current?.click()}
            >
              <span className="flex size-16 items-center justify-center rounded-full bg-signal/10 text-signal">
                <Upload className="size-7" />
              </span>
              <span className="inline-flex h-12 items-center rounded-xl bg-primary px-8 text-base font-semibold text-primary-foreground">
                {tool.multiple ? "Select files" : "Select a file"}
              </span>
              <span className="text-sm text-muted-foreground">
                or drop {dropLabel(tool)} here
              </span>
            </button>
            {options.kind === "scan" ? (
              <aside className="space-y-4 lg:border-l lg:border-ink/10 lg:pl-6">
                <h2 className="text-lg font-semibold text-ink">Camera</h2>
                {optionsPanel}
              </aside>
            ) : null}
          </div>
        )}

        {(settled || busy) && options.kind === "ask" && (
          <AskChat
            files={files}
            onFiles={(next) => setFiles(next.slice(0, 10))}
            onAddMore={() => inputRef.current?.click()}
          />
        )}

        {(settled || busy) && options.kind !== "ask" && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="min-w-0 space-y-5">
              {options.kind === "scan" ? (
                <ScanStudio
                  files={files}
                  options={options}
                  onOptions={setOptions}
                  onFiles={setFiles}
                  onAddMore={() => inputRef.current?.click()}
                  disabled={locked}
                />
              ) : optionsInCanvas ? (
                <div className="flex items-center gap-3 rounded-xl border border-ink/10 bg-secondary px-3 py-2.5">
                  <SourceIcon className="size-4 shrink-0 text-signal" />
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
              {options.kind === "compare" && files[0] && files[1] ? (
                <ComparePreview
                  left={files[0].file}
                  right={files[1].file}
                  leftPages={pdfPageCount(previews.get(files[0].id)?.facts)}
                  rightPages={pdfPageCount(previews.get(files[1].id)?.facts)}
                  pageIndex={options.pageIndex}
                  onPageIndex={(pageIndex) =>
                    setOptions({ ...options, pageIndex })
                  }
                  disabled={locked}
                />
              ) : null}
              {overlayFile && options.kind === "sign" ? (
                <SignCanvas
                  file={overlayFile}
                  placements={options.placements}
                  onPlacements={(placements) => setOptions({ kind: "sign", placements })}
                  pageCount={pageCount}
                  disabled={locked}
                />
              ) : null}
              {overlayFile && options.kind === "fill-form" ? (
                <FillFormCanvas
                  file={overlayFile}
                  options={options}
                  onOptions={setOptions}
                  disabled={locked}
                />
              ) : null}
              {overlayFile && options.kind === "edit" ? (
                <PdfEditCanvas
                  file={overlayFile}
                  marks={options.marks}
                  onMarks={(marks) => setOptions({ kind: "edit", marks })}
                  pageCount={pageCount}
                  disabled={locked}
                />
              ) : null}
              {overlayFile && options.kind === "redact" ? (
                <RedactOverlay
                  file={overlayFile}
                  options={options}
                  onOptions={setOptions}
                  pageCount={pageCount}
                  disabled={locked}
                />
              ) : null}
              {options.kind === "image-crop" && files[0] ? (
                <ImageCropOverlay
                  file={files[0].file}
                  box={options.box}
                  onBox={(box) => setOptions({ ...options, box })}
                  disabled={locked}
                  label="Keep this area"
                />
              ) : null}
              {options.kind === "extract-images" && files[0] ? (
                <ExtractImagesGrid
                  file={files[0].file}
                  baseName={files[0].name.replace(/\.[^.]+$/, "")}
                  options={options}
                  onOptions={setOptions}
                  disabled={locked}
                />
              ) : null}
              {options.kind === "convert-doc" && options.src === "csv" && files[0] ? (
                <CsvPreview
                  file={files[0].file}
                  options={options}
                  onOptions={(patch) => setOptions({ ...options, ...patch })}
                  disabled={locked}
                />
              ) : null}
              {optionsInCanvas && options.kind !== "edit" && options.kind !== "sign" && options.kind !== "fill-form" && optionsPanel}
            </div>

            <aside className="space-y-4 lg:border-l lg:border-ink/10 lg:pl-6">
              <div>
                <h2 className="text-lg font-semibold text-ink">
                  {options.kind === "none" ? "Ready to run" : "Settings"}
                </h2>
                <div className="mt-2 space-y-2 rounded-lg border border-ink/10 bg-secondary px-3 py-2.5 text-sm text-muted-foreground">
                  <p>{optionsHint(options, tool.actionLabel)}</p>
                  {largeJob && (
                    <p className="font-medium text-ink">
                      This file is large for this device. Stay on Light, or
                      expect a wait.
                    </p>
                  )}
                  {reorderable && files.length > 1 && (
                    <p>Output follows the order of the cards.</p>
                  )}
                  {(tool.id === "merge-pdf" || tool.id === "alternate-mix") &&
                    files.length < 2 && (
                    <p className="font-medium text-ink">
                      Add at least two PDFs to {tool.id === "merge-pdf" ? "merge" : "mix"}.
                    </p>
                  )}
                </div>
              </div>

              {(!optionsInCanvas || options.kind === "fill-form") && optionsPanel}

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
            showSaving={SHRINK_TOOLS.has(tool.id)}
            continueTargets={continueToolsFor(
              tool.id,
              job.results.map((result) => ({ type: result.blob.type })),
            )}
            onContinue={continueWith}
            workflowHref={
              isWorkflowTool(tool.id) &&
              options.kind === initialOptions(tool.ui).kind &&
              optionsReady(options, confirmPassword)
                ? `/tools/workflow${shareFragment([{ toolId: tool.id, options }])}`
                : undefined
            }
          />
        )}

        {job.status !== "idle" && options.kind !== "ask" && (
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
              {tool.ui === "ask"
                ? "The PDFs stay in this tab. Their text and your chat go to Google Gemini."
                : "Runs in this tab. Nothing is uploaded."}
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
                  {options.kind === "unlock" && options.lock === "restricted"
                    ? "Remove restrictions"
                    : tool.actionLabel}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
