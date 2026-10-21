"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  Link2,
  Loader2,
  Lock,
  Minus,
  Play,
  Plus,
  Save,
  Settings2,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import JSZip from "jszip";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { OptionsPanel, optionsHint } from "@/components/workbench/options-panel";
import { CONTINUE_MAP } from "@/lib/continue-map";
import type { ToolId } from "@/lib/tools";
import {
  WORKFLOW_TOOLS,
  fileFitsTool,
  workflowTool,
  workflowToolDefinition,
} from "@/lib/workflow/catalog";
import {
  runWorkflow,
  uniqueNames,
  type CellState,
  type RunEvent,
  type WorkflowRun,
} from "@/lib/workflow/engine";
import { PRESETS, presetSteps } from "@/lib/workflow/presets";
import {
  MAX_STEPS,
  decodeWorkflow,
  readShareFragment,
  shareFragment,
} from "@/lib/workflow/share";
import {
  deleteSaved,
  listSaved,
  saveWorkflow,
  type SavedWorkflow,
} from "@/lib/workflow/storage";
import {
  newStep,
  stepIsTogether,
  validateWorkflow,
  type WorkflowStep,
} from "@/lib/workflow/validate";
import { cn, downloadBlob, formatBytes } from "@/lib/utils";

type Row = { key: string; step: WorkflowStep };
type BatchFile = { key: string; file: File };
type Cell = { state: CellState; progress?: number; error?: string };

const KIND_WORD = { pdf: "PDF", image: "image", doc: "document" } as const;

const ANY_INPUT =
  "application/pdf,.pdf,image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,.docx,.xlsx,.xls,.pptx,.md,.csv,.html";

const clock = () => performance.now();

function makeRow(step: WorkflowStep): Row {
  return { key: crypto.randomUUID(), step };
}

function toolTitle(id: ToolId) {
  return workflowToolDefinition(id).title;
}

/** Tools that can follow a step writing `out`, suggestions from the Continue map first. */
function followers(last: ToolId | undefined): { suggested: ToolId[]; rest: ToolId[] } {
  if (!last) {
    const all = WORKFLOW_TOOLS.map((info) => info.id);
    return { suggested: [], rest: all };
  }
  const out = workflowTool(last)?.out;
  const fits = WORKFLOW_TOOLS.filter((info) => info.in === out).map((info) => info.id);
  const suggested = (CONTINUE_MAP[last] ?? []).filter((id) => fits.includes(id));
  return {
    suggested,
    rest: fits.filter((id) => !suggested.includes(id)),
  };
}

export function WorkflowBuilder() {
  const [rows, setRows] = useState<Row[]>([]);
  const [confirms, setConfirms] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [run, setRun] = useState<WorkflowRun | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [snap, setSnap] = useState<Map<string, Cell>>(() => new Map());
  const [saved, setSaved] = useState<SavedWorkflow[]>([]);
  const [saveName, setSaveName] = useState("");
  const [notice, setNotice] = useState("");
  const [fatal, setFatal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cells = useRef(new Map<string, Cell>());
  const abort = useRef<AbortController | null>(null);

  // Saved workflows and a share link live in the browser only, so they load after mount.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only state read once after mount */
    try {
      setSaved(listSaved(window.localStorage));
    } catch {
      setSaved([]);
    }
    const shared = readShareFragment(window.location.hash);
    if (shared) {
      setRows(shared.map(makeRow));
      setNotice(
        "Loaded the steps from a shared link. Files and passwords are never in a link.",
      );
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const steps = useMemo(() => rows.map((row) => row.step), [rows]);
  const issues = useMemo(
    () => validateWorkflow(steps, rows.map((row) => confirms[row.key])),
    [steps, rows, confirms],
  );
  const busy = phase === "running";
  const locked = busy;

  const firstTool = steps[0]?.toolId;
  const accept = firstTool ? workflowToolDefinition(firstTool).accept : ANY_INPUT;
  const misfits = useMemo(
    () =>
      firstTool
        ? new Set(
            files
              .filter(
                (entry) =>
                  !fileFitsTool(firstTool, { name: entry.file.name, type: entry.file.type }),
              )
              .map((entry) => entry.key),
          )
        : new Set<string>(),
    [files, firstTool],
  );

  const setStep = (key: string, patch: Partial<WorkflowStep>) =>
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, step: { ...row.step, ...patch } } : row,
      ),
    );

  const addStep = (id: ToolId) => {
    if (rows.length >= MAX_STEPS) return;
    const row = makeRow(newStep(id));
    setRows((current) => [...current, row]);
    setOpen((current) => ({ ...current, [row.key]: true }));
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    setRows((current) => {
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const loadSteps = (next: WorkflowStep[], message: string) => {
    setRows(next.map(makeRow));
    setConfirms({});
    setOpen({});
    setRun(null);
    setPhase("idle");
    setNotice(message);
  };

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list || list.length === 0) return;
    const picked = Array.from(list).map((file) => ({ key: crypto.randomUUID(), file }));
    setFiles((current) => [...current, ...picked]);
    setRun(null);
    setPhase((current) => (current === "done" ? "idle" : current));
  }, []);

  const start = async () => {
    if (busy || issues.length > 0 || files.length === 0) return;
    const controller = new AbortController();
    abort.current = controller;
    cells.current = new Map();
    setFatal("");
    setRun(null);
    setPhase("running");
    const began = clock();
    const timer = window.setInterval(() => {
      setElapsed(clock() - began);
      setSnap(new Map(cells.current));
    }, 150);
    const onEvent = (event: RunEvent) => {
      cells.current.set(`${event.lane}:${event.step}`, {
        state: event.state,
        progress: event.progress,
        error: event.error,
      });
    };
    try {
      const { runTool } = await import("@/lib/run-tool");
      const result = await runWorkflow({
        steps,
        files: files.map((entry) => entry.file),
        run: runTool,
        signal: controller.signal,
        onEvent,
        // OCR spawns its own workers, so one file at a time there.
        concurrency: steps.some((step) => step.toolId === "ocr-pdf") ? 1 : 2,
      });
      setRun(result);
    } catch (error) {
      setFatal(error instanceof Error ? error.message : "The workflow stopped.");
    } finally {
      window.clearInterval(timer);
      setSnap(new Map(cells.current));
      setElapsed(clock() - began);
      setPhase("done");
      abort.current = null;
    }
  };

  const downloadZip = async () => {
    if (!run) return;
    const zip = new JSZip();
    const names = uniqueNames(run.outputs.map((out) => out.name));
    run.outputs.forEach((out, i) => zip.file(names[i], out.blob));
    downloadBlob(await zip.generateAsync({ type: "blob" }), "ihateupload-workflow.zip");
  };

  const persist = () => {
    try {
      setSaved(saveWorkflow(window.localStorage, saveName, steps));
      setNotice("Saved in this browser. Passwords are not saved.");
    } catch {
      setNotice("This browser would not let us save.");
    }
  };

  const copyLink = async () => {
    const link = `${window.location.origin}${window.location.pathname}${shareFragment(steps)}`;
    try {
      await navigator.clipboard.writeText(link);
      setNotice("Link copied. It holds the steps and settings only, never files or passwords.");
    } catch {
      setNotice(link);
    }
    window.history.replaceState(null, "", shareFragment(steps));
  };

  const { suggested, rest } = followers(steps[steps.length - 1]?.toolId);
  const ready = issues.length === 0 && files.length > 0;
  const stepCount = rows.length;
  const totalCells = (run?.lanes.length ?? files.length) * Math.max(1, stepCount);
  let finished = 0;
  for (const cell of snap.values()) {
    if (cell.state === "done" || cell.state === "failed" || cell.state === "skipped" || cell.state === "merged" || cell.state === "cancelled") finished++;
    else if (cell.state === "running") finished += cell.progress ?? 0;
  }
  const overall = Math.min(100, Math.round((finished / totalCells) * 100));
  const failures = run?.lanes.filter((lane) => lane.status === "failed") ?? [];
  const totalIn = run?.lanes.reduce((sum, lane) => sum + lane.inputSize, 0) ?? 0;
  const totalOut = run?.outputs.reduce((sum, out) => sum + out.size, 0) ?? 0;

  return (
    <div className="w-full space-y-6">
      <section aria-labelledby="wf-presets" className="rounded-2xl border border-ink/10 bg-card p-5 shadow-[0_18px_40px_-24px_rgba(20,22,28,0.28)] sm:p-8">
        <h2 id="wf-presets" className="text-lg font-semibold text-ink">
          Start from a preset
        </h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={locked}
              onClick={() => loadSteps(presetSteps(preset), `Loaded "${preset.title}".`)}
              className="rounded-xl border border-ink/10 bg-background p-3 text-left transition-colors hover:border-signal/40 disabled:opacity-50"
            >
              <span className="block text-sm font-semibold text-ink">{preset.title}</span>
              <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                {preset.blurb}
              </span>
            </button>
          ))}
        </div>
        {saved.length > 0 && (
          <div className="mt-5">
            <h3 className="text-sm font-semibold text-ink">Your saved workflows</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {saved.map((entry) => (
                <li
                  key={entry.id}
                  className="inline-flex items-center overflow-hidden rounded-full border border-ink/12 bg-background text-sm"
                >
                  <button
                    type="button"
                    disabled={locked}
                    className="px-3 py-1.5 font-medium text-ink hover:text-signal-ink"
                    onClick={() => {
                      const decoded = decodeWorkflow(entry.steps);
                      if (decoded) loadSteps(decoded, `Loaded "${entry.name}".`);
                    }}
                  >
                    {entry.name}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${entry.name}`}
                    className="border-l border-ink/10 px-2 py-1.5 text-muted-foreground hover:text-destructive"
                    onClick={() => setSaved(deleteSaved(window.localStorage, entry.id))}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="wf-steps" className="rounded-2xl border border-ink/10 bg-card p-5 shadow-[0_18px_40px_-24px_rgba(20,22,28,0.28)] sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="wf-steps" className="text-lg font-semibold text-ink">
            1. Steps
          </h2>
          <p className="text-sm text-muted-foreground">
            Each step reads what the one before wrote.
          </p>
        </div>

        {rows.length === 0 && (
          <p className="mt-4 rounded-xl border border-dashed border-ink/15 bg-background px-4 py-6 text-center text-sm text-muted-foreground">
            No steps yet. Pick a preset above or add a tool below.
          </p>
        )}

        <ol className="mt-4 space-y-3">
          {rows.map((row, index) => {
            const { step } = row;
            const info = workflowTool(step.toolId);
            const tool = workflowToolDefinition(step.toolId);
            const stepIssues = issues.filter((issue) => issue.step === index);
            const together = stepIsTogether(step);
            const expanded = open[row.key] ?? false;
            return (
              <li
                key={row.key}
                data-testid="wf-step"
                className={cn(
                  "rounded-xl border bg-background",
                  stepIssues.length ? "border-destructive/40" : "border-ink/10",
                )}
              >
                <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-signal/10 text-sm font-semibold text-signal-ink">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{tool.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {info ? `${KIND_WORD[info.in]} in, ${KIND_WORD[info.out]} out` : ""}
                      {together ? " · all files become one" : info?.fanOut ? " · one file can become several" : " · runs on each file"}
                    </p>
                  </div>
                  {info?.scope === "choice" && (
                    <label className="flex items-center gap-1.5 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={together}
                        disabled={locked}
                        onChange={(e) => setStep(row.key, { together: e.target.checked })}
                      />
                      One PDF for all files
                    </label>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    aria-expanded={expanded}
                    onClick={() => setOpen((cur) => ({ ...cur, [row.key]: !expanded }))}
                  >
                    <Settings2 />
                    Settings
                    <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move step ${index + 1} up`} disabled={locked || index === 0} onClick={() => moveStep(index, -1)}>
                    <ArrowUp />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move step ${index + 1} down`} disabled={locked || index === rows.length - 1} onClick={() => moveStep(index, 1)}>
                    <ArrowDown />
                  </Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove step ${index + 1}`} disabled={locked} onClick={() => setRows((cur) => cur.filter((r) => r.key !== row.key))}>
                    <Minus />
                  </Button>
                </div>
                {stepIssues.map((issue) => (
                  <p key={issue.message} role="alert" className="flex items-start gap-1.5 px-3 pb-2.5 text-xs font-medium text-destructive">
                    <AlertTriangle className="mt-px size-3.5 shrink-0" />
                    {issue.message}
                  </p>
                ))}
                {expanded && (
                  <div className="space-y-3 border-t border-ink/10 px-3 py-3">
                    <p className="text-xs text-muted-foreground">
                      {optionsHint(step.options, tool.actionLabel)}
                    </p>
                    <OptionsPanel
                      options={step.options}
                      onOptions={(options) => setStep(row.key, { options })}
                      confirmPassword={confirms[row.key] ?? ""}
                      onConfirmPassword={(value) =>
                        setConfirms((cur) => ({ ...cur, [row.key]: value }))
                      }
                      pageCount={0}
                      disabled={locked}
                      files={[]}
                      filePages={[]}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        {rows.length < MAX_STEPS && (
          <div className="mt-4 space-y-2 border-t border-ink/10 pt-4">
            <p className="text-sm font-medium text-ink">
              {rows.length === 0 ? "Add the first step" : "Add the next step"}
            </p>
            {suggested.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggested.map((id) => (
                  <Button key={id} type="button" size="sm" variant="outline" disabled={locked} onClick={() => addStep(id)}>
                    <Plus />
                    {workflowToolDefinition(id).shortTitle}
                  </Button>
                ))}
              </div>
            )}
            <label className="block">
              <span className="sr-only">Add a step</span>
              <select
                aria-label="Add a step"
                disabled={locked}
                value=""
                onChange={(e) => {
                  if (e.target.value) addStep(e.target.value as ToolId);
                }}
                className="h-9 w-full max-w-xs rounded-lg border border-ink/15 bg-background px-2 text-sm text-ink"
              >
                <option value="">{suggested.length ? "More tools…" : "Choose a tool…"}</option>
                {rest.map((id) => (
                  <option key={id} value={id}>
                    {toolTitle(id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-4">
          <Input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Name this workflow"
            aria-label="Workflow name"
            className="h-8 max-w-56"
            maxLength={60}
          />
          <Button type="button" size="sm" variant="outline" disabled={rows.length === 0} onClick={persist}>
            <Save />
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={rows.length === 0} onClick={() => void copyLink()}>
            <Link2 />
            Copy share link
          </Button>
          <span className="text-xs text-muted-foreground">
            Links and saves keep steps and settings, never files or passwords.
          </span>
        </div>
        {notice && (
          <p role="status" className="mt-3 text-sm text-ink/80">
            {notice}
          </p>
        )}
      </section>

      <section aria-labelledby="wf-files" className="rounded-2xl border border-ink/10 bg-card p-5 shadow-[0_18px_40px_-24px_rgba(20,22,28,0.28)] sm:p-8">
        <h2 id="wf-files" className="text-lg font-semibold text-ink">
          2. Files
        </h2>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          aria-label="Choose files"
          className="sr-only"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={locked}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!locked) addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-ink/15 bg-background px-4 py-8 text-center transition-colors hover:border-signal/40",
            dragging && "border-signal ring-2 ring-signal/30",
          )}
        >
          <Upload className="size-6 text-signal" />
          <span className="text-sm font-semibold text-ink">Select files or drop them here</span>
          <span className="text-xs text-muted-foreground">
            As many as you like. They stay in this tab.
          </span>
        </button>

        {files.length > 0 && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm">
              <p className="font-medium text-ink">
                {files.length} {files.length === 1 ? "file" : "files"},{" "}
                {formatBytes(files.reduce((sum, entry) => sum + entry.file.size, 0))}
              </p>
              <Button type="button" size="sm" variant="ghost" disabled={locked} onClick={() => { setFiles([]); setRun(null); setPhase("idle"); }}>
                <Trash2 />
                Clear
              </Button>
            </div>
            <ul className="mt-2 max-h-56 space-y-1 overflow-auto">
              {files.map((entry) => (
                <li key={entry.key} className="flex items-center gap-2 rounded-lg border border-ink/10 bg-background px-3 py-1.5 text-sm">
                  <span className="min-w-0 flex-1 truncate text-ink" title={entry.file.name}>
                    {entry.file.name}
                  </span>
                  {misfits.has(entry.key) && (
                    <span className="text-xs font-medium text-destructive">
                      Step 1 cannot read this
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{formatBytes(entry.file.size)}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${entry.file.name}`}
                    disabled={locked}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-40"
                    onClick={() => setFiles((cur) => cur.filter((f) => f.key !== entry.key))}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="wf-run" className="rounded-2xl border border-ink/10 bg-card p-5 shadow-[0_18px_40px_-24px_rgba(20,22,28,0.28)] sm:p-8">
        <h2 id="wf-run" className="text-lg font-semibold text-ink">
          3. Run
        </h2>
        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" />
          Runs in this tab. Nothing is uploaded.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {busy ? (
            <Button type="button" size="lg" variant="outline" className="h-11" onClick={() => abort.current?.abort()}>
              <Square />
              Cancel
            </Button>
          ) : (
            <Button type="button" size="lg" className="h-11 px-6 text-base" disabled={!ready} onClick={() => void start()}>
              <Play />
              Run on {files.length || "your"} {files.length === 1 ? "file" : "files"}
            </Button>
          )}
          {!busy && !ready && (
            <span className="text-sm text-muted-foreground">
              {rows.length === 0
                ? "Add a step first."
                : issues.length > 0
                  ? "Fix the marked steps first."
                  : "Add files to run on."}
            </span>
          )}
        </div>

        {busy && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-ink">
                <Loader2 className="size-4 animate-spin text-signal" />
                Working locally…
              </span>
              <span className="text-muted-foreground">{overall}%</span>
            </div>
            <Progress value={overall} aria-label="Workflow progress" aria-valuetext={`${overall} percent`} />
          </div>
        )}

        {fatal && (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {fatal}
          </p>
        )}

        {(busy || run) && files.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-ink/10">
            <table className="w-full min-w-[32rem] text-left text-sm" data-testid="wf-grid">
              <thead className="bg-secondary text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">File</th>
                  {rows.map((row, i) => (
                    <th key={row.key} className="px-3 py-2 font-medium">
                      {i + 1}. {workflowToolDefinition(row.step.toolId).shortTitle}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {files.map((entry, lane) => (
                  <tr key={entry.key} className="border-t border-ink/8">
                    <td className="max-w-48 truncate px-3 py-1.5 text-ink" title={entry.file.name}>
                      {entry.file.name}
                    </td>
                    {rows.map((row, i) => (
                      <CellView key={row.key} cell={snap.get(`${lane}:${i}`)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {phase === "done" && run && (
          <div className="mt-5 space-y-4" data-testid="wf-results">
            <div role="status" aria-live="polite" className="rounded-xl border border-signal/20 bg-signal/5 px-4 py-3">
              <p className="flex items-center gap-2 text-base font-semibold text-ink">
                <Check className="size-4 text-signal" />
                {run.cancelled ? "Cancelled. " : ""}
                {run.outputs.length} {run.outputs.length === 1 ? "file" : "files"} ready
                {failures.length > 0 ? `, ${failures.length} failed` : ""}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {(elapsed / 1000).toFixed(1)} s. {formatBytes(totalIn)} in, {formatBytes(totalOut)} out. Built on this device.
              </p>
            </div>

            {failures.length > 0 && (
              <ul className="space-y-1" aria-label="Files that failed">
                {failures.map((lane) => (
                  <li key={lane.lane} className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    <span className="font-medium">{lane.name}</span>
                    {lane.step !== undefined ? ` stopped at step ${lane.step + 1}` : ""}: {lane.error}
                  </li>
                ))}
              </ul>
            )}

            {run.outputs.length > 0 && (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => (run.outputs.length === 1 ? downloadBlob(run.outputs[0].blob, run.outputs[0].name) : void downloadZip())} className="h-10 px-4">
                    <Download />
                    {run.outputs.length === 1 ? "Download" : `Download all as ZIP (${run.outputs.length})`}
                  </Button>
                </div>
                <ul className="max-h-80 space-y-2 overflow-auto">
                  {run.outputs.map((out) => (
                    <li key={out.id} className="flex items-center gap-3 rounded-lg border border-ink/10 bg-card px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink" title={out.name}>
                          {out.name}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatBytes(out.size)}</p>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => downloadBlob(out.blob, out.name)}>
                        <Download />
                        Save
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function CellView({ cell }: { cell: Cell | undefined }) {
  const state = cell?.state ?? "pending";
  return (
    <td className="px-3 py-1.5" data-state={state} title={cell?.error}>
      {state === "done" ? (
        <span className="inline-flex items-center gap-1 text-signal-ink">
          <Check className="size-3.5" /> Done
        </span>
      ) : state === "running" ? (
        <span className="inline-flex items-center gap-1 text-ink">
          <Loader2 className="size-3.5 animate-spin" />
          {Math.round((cell?.progress ?? 0) * 100)}%
        </span>
      ) : state === "failed" ? (
        <span className="inline-flex items-center gap-1 text-destructive">
          <AlertTriangle className="size-3.5" /> Failed
        </span>
      ) : state === "merged" ? (
        <span className="text-muted-foreground">Merged</span>
      ) : state === "skipped" ? (
        <span className="text-muted-foreground">Skipped</span>
      ) : state === "cancelled" ? (
        <span className="text-muted-foreground">Cancelled</span>
      ) : (
        <span className="text-muted-foreground">Waiting</span>
      )}
    </td>
  );
}
