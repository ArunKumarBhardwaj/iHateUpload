"use client";

import { Check } from "lucide-react";

import type { JobState } from "@/lib/job";
import type { ToolOptions } from "@/lib/tool-options";
import { cn } from "@/lib/utils";

type StepId = "choose" | "options" | "run" | "download";

const STEP_LABELS: Record<StepId, string> = {
  choose: "Choose",
  options: "Options",
  run: "Process",
  download: "Download",
};

function labelFor(step: StepId, options: ToolOptions): string {
  if (options.kind !== "ask") return STEP_LABELS[step];
  if (step === "options") return "Question";
  if (step === "run") return "Ask";
  if (step === "download") return "Answer";
  return STEP_LABELS[step];
}

function stepsFor(options: ToolOptions): StepId[] {
  return options.kind === "none"
    ? ["choose", "run", "download"]
    : ["choose", "options", "run", "download"];
}

function currentStep(job: JobState, hasOptions: boolean): StepId {
  switch (job.status) {
    case "idle":
      return "choose";
    case "ready":
    case "error":
      return hasOptions ? "options" : "run";
    case "processing":
      return "run";
    case "done":
      return "download";
  }
}

export function Stepper({
  job,
  options,
}: {
  job: JobState;
  options: ToolOptions;
}) {
  const steps = stepsFor(options);
  const active = steps.indexOf(currentStep(job, options.kind !== "none"));

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {steps.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 && <span className="hidden text-ink/25 sm:inline" aria-hidden>/</span>}
          <span
            aria-current={index === active ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
              index === active && "bg-signal/10 text-signal-ink",
              index < active && "text-ink",
              index > active && "text-muted-foreground",
            )}
          >
            {index < active ? (
              <Check className="size-4" />
            ) : (
              <span
                className={cn(
                  "inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                  index === active
                    ? "bg-signal text-primary-foreground"
                    : "bg-ink/10 text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
            )}
            {labelFor(step, options)}
          </span>
        </li>
      ))}
    </ol>
  );
}
