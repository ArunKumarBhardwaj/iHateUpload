"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileImage, FileText, Loader2, Upload } from "lucide-react";
import JSZip from "jszip";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import type { ToolOptions } from "@/lib/tool-options";
import type { ToolDefinition, ToolId } from "@/lib/tools";
import {
  getPdfPageCount,
  processCompressImage,
  processCompressPdf,
  processHeicToJpg,
  processImageToPdf,
  processMergePdf,
  processOrganizePdf,
  processPdfToJpg,
  processProtectPdf,
  processRotatePdf,
  processSplitPdf,
  processUnlockPdf,
  processWebpToJpg,
} from "@/lib/processors";
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

async function downloadAllResults(results: ResultItem[]) {
  const zip = new JSZip();
  for (const result of results) {
    zip.file(result.name, result.blob);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "ihateupload-results.zip");
}

type RotateDegrees = 90 | 180 | 270;

export function ToolWorkspace({ tool }: { tool: ToolDefinition }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [job, setJob] = useState<JobState>(idleJob);
  const [dragging, setDragging] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rotateDegrees, setRotateDegrees] = useState<RotateDegrees>(90);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const FileIcon = tool.kind === "pdf" ? FileText : FileImage;

  const files =
    job.status === "idle" ? [] : "files" in job ? job.files : [];

  const passwordConfirmMismatch =
    tool.ui === "password-confirm" &&
    password.length > 0 &&
    confirmPassword.length > 0 &&
    password !== confirmPassword;

  const canProcess =
    job.status === "ready" &&
    (tool.id !== "merge-pdf" || job.files.length >= 2) &&
    (tool.ui !== "password" || password.trim().length > 0) &&
    (tool.ui !== "password-confirm" ||
      (password.trim().length > 0 &&
        confirmPassword === password &&
        !passwordConfirmMismatch)) &&
    (tool.ui !== "organize" || pageOrder.length >= 1);

  const setFiles = useCallback((next: FileItem[]) => {
    if (next.length === 0) {
      setJob(idleJob());
      return;
    }
    setJob({ status: "ready", files: next });
  }, []);

  useEffect(() => {
    setPassword("");
    setConfirmPassword("");
    setRotateDegrees(90);
    setPageOrder([]);
  }, [tool.id]);

  useEffect(() => {
    const handoff = takeHandoff();
    if (!handoff) return;
    const items = createFileItems(handoff.files);
    setFiles(tool.multiple ? items : items.slice(0, 1));
  }, [tool.id, tool.multiple, setFiles]);

  const organizeSource =
    tool.ui === "organize" &&
    (job.status === "ready" || job.status === "error")
      ? job.files[0]
      : undefined;

  useEffect(() => {
    if (!organizeSource) {
      setPageOrder([]);
      return;
    }
    let cancelled = false;
    getPdfPageCount(organizeSource.file)
      .then((count) => {
        if (cancelled) return;
        setPageOrder(Array.from({ length: count }, (_, i) => i));
      })
      .catch(() => {
        if (!cancelled) setPageOrder([]);
      });
    return () => {
      cancelled = true;
    };
  }, [organizeSource?.id]);

  const onPick = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const items = createFileItems(list);
      setFiles(tool.multiple ? items : items.slice(0, 1));
    },
    [setFiles, tool.multiple],
  );

  const buildOptions = useCallback((): ToolOptions => {
    switch (tool.ui) {
      case "password":
        return { kind: "password", password };
      case "password-confirm":
        return { kind: "password-confirm", password };
      case "rotate":
        return { kind: "rotate", degrees: rotateDegrees };
      case "organize":
        return { kind: "organize", pageOrder };
      case "none":
        return { kind: "none" };
    }
  }, [tool.ui, password, rotateDegrees, pageOrder]);

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
    const options = buildOptions();
    setJob({ status: "processing", files: current, progress: 0 });
    try {
      const results = await runTool(tool.id, current, (ratio) => {
        setJob({
          status: "processing",
          files: current,
          progress: Math.round(ratio * 100),
        });
      }, options);
      setJob({ status: "done", files: current, results });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong while processing.";
      setJob({ status: "error", message, files: current });
    }
  }, [job, tool.id, buildOptions]);

  const reset = () => {
    setJob(idleJob());
    setPassword("");
    setConfirmPassword("");
    setRotateDegrees(90);
    setPageOrder([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const continueTargets =
    job.status === "done"
      ? continueToolsFor(
          tool.id,
          job.results.map((result) => ({ type: result.blob.type })),
        )
      : [];

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

  const movePage = (index: number, direction: -1 | 1) => {
    setPageOrder((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const tmp = next[index];
      next[index] = next[target];
      next[target] = tmp;
      return next;
    });
  };

  const removePage = (index: number) => {
    setPageOrder((prev) => prev.filter((_, i) => i !== index));
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

        {(job.status === "ready" || job.status === "error") &&
          tool.ui === "password" && (
            <div className="mt-5 space-y-2">
              <label className="text-sm font-medium text-ink" htmlFor="pdf-password">
                Password
              </label>
              <Input
                id="pdf-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="PDF password"
              />
            </div>
          )}

        {(job.status === "ready" || job.status === "error") &&
          tool.ui === "password-confirm" && (
            <div className="mt-5 space-y-3">
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-ink"
                  htmlFor="pdf-password"
                >
                  Password
                </label>
                <Input
                  id="pdf-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Choose a password"
                />
              </div>
              <div className="space-y-2">
                <label
                  className="text-sm font-medium text-ink"
                  htmlFor="pdf-password-confirm"
                >
                  Confirm password
                </label>
                <Input
                  id="pdf-password-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat password"
                  aria-invalid={passwordConfirmMismatch}
                />
              </div>
              {passwordConfirmMismatch && (
                <p className="text-sm text-destructive">
                  Passwords do not match.
                </p>
              )}
            </div>
          )}

        {(job.status === "ready" || job.status === "error") &&
          tool.ui === "rotate" && (
            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium text-ink">Rotate by</p>
              <div className="flex flex-wrap gap-2">
                {([90, 180, 270] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={rotateDegrees === value ? "default" : "outline"}
                    onClick={() => setRotateDegrees(value)}
                  >
                    {value}°
                  </Button>
                ))}
              </div>
            </div>
          )}

        {(job.status === "ready" || job.status === "error") &&
          tool.ui === "organize" &&
          pageOrder.length > 0 && (
            <div className="mt-5 space-y-2">
              <p className="text-sm font-medium text-ink">Pages</p>
              <ul className="space-y-2">
                {pageOrder.map((pageIndex, listIndex) => (
                  <li
                    key={`${pageIndex}-${listIndex}`}
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-ink/10 bg-background/70 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                      Page {pageIndex + 1}
                    </span>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={listIndex === 0}
                      onClick={() => movePage(listIndex, -1)}
                    >
                      Move up
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={listIndex === pageOrder.length - 1}
                      onClick={() => movePage(listIndex, 1)}
                    >
                      Move down
                    </Button>
                    <Button
                      type="button"
                      size="xs"
                      variant="outline"
                      disabled={pageOrder.length <= 1}
                      onClick={() => removePage(listIndex)}
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
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
            {continueTargets.length > 0 && (
              <div className="space-y-2 border-t border-ink/10 pt-4">
                <p className="text-sm font-medium text-ink">Continue with</p>
                <div className="flex flex-wrap gap-2">
                  {continueTargets.map((next) => (
                    <Button
                      key={next.id}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => continueWith(next)}
                    >
                      {next.shortTitle}
                    </Button>
                  ))}
                </div>
              </div>
            )}
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
