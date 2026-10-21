import type { FileItem, ResultItem } from "@/lib/job";
import type { ToolOptions } from "@/lib/tool-options";
import type { ToolId } from "@/lib/tools";
import { fileFitsTool, workflowToolDefinition } from "@/lib/workflow/catalog";
import {
  stepIsTogether,
  validateWorkflow,
  type WorkflowStep,
} from "@/lib/workflow/validate";

/** Runs one tool on some files. The app passes `runTool`; tests pass a stand-in. */
export type StepRunner = (
  toolId: ToolId,
  files: FileItem[],
  onProgress: (ratio: number) => void,
  options: ToolOptions,
) => Promise<ResultItem[]>;

export type CellState =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "skipped"
  | "merged"
  | "cancelled";

export type RunEvent = {
  /** Which input file's row, by its index in the batch. */
  lane: number;
  step: number;
  state: CellState;
  /** 0 to 1 while running. */
  progress?: number;
  error?: string;
};

export type LaneStatus = "done" | "failed" | "cancelled" | "merged";

export type LaneResult = {
  lane: number;
  name: string;
  inputSize: number;
  status: LaneStatus;
  /** The step that failed or was reached when cancelled. */
  step?: number;
  error?: string;
  /** What this input ended as. Several after a split, none after a failure. */
  outputs: ResultItem[];
  /** For a merged lane: the lane whose result holds it. */
  mergedInto?: number;
};

export type WorkflowRun = {
  lanes: LaneResult[];
  /** Every finished output, in input order. */
  outputs: ResultItem[];
  cancelled: boolean;
};

type Lane = {
  index: number;
  name: string;
  inputSize: number;
  items: ResultItem[];
  alive: boolean;
  /** Steps this row has finished. */
  next: number;
  result: LaneResult;
};

function message(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong.";
}

function asFileItem(item: ResultItem): FileItem {
  return {
    id: item.id,
    name: item.name,
    size: item.size,
    file: new File([item.blob], item.name, {
      type: item.blob.type || "application/octet-stream",
    }),
  };
}

function inputItem(file: File): ResultItem {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    blob: file,
    originalSize: file.size,
  };
}

/** Runs `work` over `items` with at most `limit` in flight. Order of starts follows the list. */
async function pool<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker),
  );
}

export type RunOptions = {
  steps: readonly WorkflowStep[];
  files: readonly File[];
  run: StepRunner;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => void;
  /** Files in flight at once on per-file steps. Default 2. */
  concurrency?: number;
};

/**
 * Runs the steps in order on every file.
 *
 * Per-file steps take one file at a time, so a failure only drops that file's
 * row; the rest carry on. A "together" step (merge) collects what the live
 * rows hold and runs once. Steps that split give a row several files, and
 * the next step runs on each. Consecutive per-file steps run row by row, so
 * only a couple of files are open at a time; intermediate results are not
 * kept past the step that uses them.
 */
export async function runWorkflow(opts: RunOptions): Promise<WorkflowRun> {
  const { steps, files, run, signal, onEvent } = opts;
  const issues = validateWorkflow(steps);
  if (issues.length > 0) throw new Error(issues[0].message);

  const concurrency = Math.max(1, opts.concurrency ?? 2);
  const emit = (event: RunEvent) => onEvent?.(event);

  const lanes: Lane[] = files.map((file, index) => ({
    index,
    name: file.name,
    inputSize: file.size,
    items: [inputItem(file)],
    alive: true,
    next: 0,
    result: {
      lane: index,
      name: file.name,
      inputSize: file.size,
      status: "done",
      outputs: [],
    },
  }));

  let cancelled = false;
  const stopped = () => {
    if (signal?.aborted) cancelled = true;
    return cancelled;
  };

  const fail = (lane: Lane, step: number, error: string) => {
    lane.alive = false;
    lane.items = [];
    lane.result = { ...lane.result, status: "failed", step, error };
    emit({ lane: lane.index, step, state: "failed", error });
    for (let later = step + 1; later < steps.length; later++) {
      emit({ lane: lane.index, step: later, state: "skipped" });
    }
  };

  /** One tool on one file's worth of results; every file must suit the tool. */
  const runOnEach = async (lane: Lane, step: number): Promise<void> => {
    const { toolId, options } = steps[step];
    const tool = workflowToolDefinition(toolId);
    const out: ResultItem[] = [];
    emit({ lane: lane.index, step, state: "running", progress: 0 });
    const total = lane.items.length;
    for (let i = 0; i < total; i++) {
      const item = lane.items[i];
      const input = asFileItem(item);
      if (!fileFitsTool(toolId, { name: input.name, type: input.file.type })) {
        throw new Error(`${tool.title} cannot read ${input.name}.`);
      }
      const results = await run(
        toolId,
        [input],
        (ratio) =>
          emit({
            lane: lane.index,
            step,
            state: "running",
            progress: (i + Math.min(1, Math.max(0, ratio))) / total,
          }),
        options,
      );
      if (results.length === 0) {
        throw new Error(`${tool.title} produced no file for ${input.name}.`);
      }
      out.push(...results);
      // The input is not needed again: let go of it before the next file.
      lane.items[i] = undefined as unknown as ResultItem;
    }
    lane.items = out;
    lane.next = step + 1;
    emit({ lane: lane.index, step, state: "done" });
  };

  let step = 0;
  while (step < steps.length && !stopped()) {
    if (stepIsTogether(steps[step])) {
      await runTogether(step);
      step += 1;
      continue;
    }
    // A run of per-file steps goes row by row.
    let end = step;
    while (end < steps.length && !stepIsTogether(steps[end])) end++;
    const live = lanes.filter((lane) => lane.alive);
    await pool(live, concurrency, async (lane) => {
      for (let s = step; s < end; s++) {
        if (stopped()) return;
        try {
          await runOnEach(lane, s);
        } catch (error) {
          fail(lane, s, message(error));
          return;
        }
      }
    });
    step = end;
  }

  async function runTogether(at: number): Promise<void> {
    const { toolId, options } = steps[at];
    const tool = workflowToolDefinition(toolId);
    const members: Lane[] = [];
    for (const lane of lanes) {
      if (!lane.alive) continue;
      const bad = lane.items.find(
        (item) => !fileFitsTool(toolId, { name: item.name, type: item.blob.type }),
      );
      if (bad) {
        fail(lane, at, `${tool.title} cannot read ${bad.name}.`);
        continue;
      }
      members.push(lane);
    }
    if (members.length === 0) return;
    for (const lane of members) {
      emit({ lane: lane.index, step: at, state: "running", progress: 0 });
    }
    try {
      const results = await run(
        toolId,
        members.flatMap((lane) => lane.items.map(asFileItem)),
        (ratio) => {
          for (const lane of members) {
            emit({ lane: lane.index, step: at, state: "running", progress: ratio });
          }
        },
        options,
      );
      if (results.length === 0) throw new Error(`${tool.title} produced no file.`);
      const [carrier, ...rest] = members;
      carrier.items = results;
      carrier.next = at + 1;
      emit({ lane: carrier.index, step: at, state: "done" });
      for (const lane of rest) {
        lane.alive = false;
        lane.items = [];
        lane.result = { ...lane.result, status: "merged", mergedInto: carrier.index };
        emit({ lane: lane.index, step: at, state: "merged" });
        for (let later = at + 1; later < steps.length; later++) {
          emit({ lane: lane.index, step: later, state: "merged" });
        }
      }
    } catch (error) {
      for (const lane of members) fail(lane, at, message(error));
    }
  }

  for (const lane of lanes) {
    if (!lane.alive) continue;
    if (lane.next >= steps.length) {
      lane.result = { ...lane.result, outputs: lane.items };
    } else {
      lane.result = { ...lane.result, status: "cancelled", step: lane.next };
      for (let s = lane.next; s < steps.length; s++) {
        emit({ lane: lane.index, step: s, state: "cancelled" });
      }
      lane.items = [];
    }
  }

  const results = lanes.map((lane) => lane.result);
  return {
    lanes: results,
    outputs: results.flatMap((result) => result.outputs),
    cancelled,
  };
}

/** Names for a zip: the same name twice gets -2, -3 ... before the extension. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    return dot > 0
      ? `${name.slice(0, dot)}-${count}${name.slice(dot)}`
      : `${name}-${count}`;
  });
}
