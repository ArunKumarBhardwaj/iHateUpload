import { toolTakesKinds } from "@/lib/continue-map";
import { optionsReady, type ToolOptions } from "@/lib/tool-options";
import {
  defaultStepOptions,
  defaultTogether,
  workflowTool,
  workflowToolDefinition,
} from "@/lib/workflow/catalog";
import type { ToolId } from "@/lib/tools";

/** One step of a workflow: a tool and the options it runs with. */
export type WorkflowStep = {
  toolId: ToolId;
  options: ToolOptions;
  /** Only read for tools that can run either way (images to PDF). */
  together?: boolean;
};

export type WorkflowIssue = {
  /** Index of the step, or -1 for the workflow as a whole. */
  step: number;
  message: string;
};

/** Whether this step takes all its files at once. */
export function stepIsTogether(step: WorkflowStep): boolean {
  const info = workflowTool(step.toolId);
  if (!info) return false;
  if (info.scope === "choice") return step.together ?? defaultTogether(info);
  return info.scope === "together";
}

export function newStep(toolId: ToolId): WorkflowStep {
  return { toolId, options: defaultStepOptions(toolId) };
}

/**
 * Checks a workflow without running it: every tool is allowed, each step can
 * read what the step before writes (the same PDF-or-image rule the "Continue
 * with" panel uses), and every step's options are complete.
 *
 * `confirms[i]` is the retyped password of step i, for tools that ask twice.
 */
export function validateWorkflow(
  steps: readonly WorkflowStep[],
  confirms: readonly (string | undefined)[] = [],
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  if (steps.length === 0) {
    return [{ step: -1, message: "Add at least one step." }];
  }

  steps.forEach((step, index) => {
    const info = workflowTool(step.toolId);
    if (!info) {
      issues.push({
        step: index,
        message: `${step.toolId} cannot run in a workflow. It needs you on the page.`,
      });
      return;
    }
    const tool = workflowToolDefinition(step.toolId);

    if (index > 0) {
      const prev = workflowTool(steps[index - 1].toolId);
      if (prev) {
        const kinds = { pdf: prev.out === "pdf", image: prev.out === "image" };
        if (info.in === "doc" || !toolTakesKinds(tool, kinds)) {
          issues.push({
            step: index,
            message:
              info.in === "doc"
                ? `${tool.title} reads documents, so it can only be the first step.`
                : `${tool.title} needs ${info.in === "pdf" ? "PDFs" : "images"}, but step ${index} gives ${prev.out === "pdf" ? "PDFs" : "images"}.`,
          });
        }
      }
    }

    if (step.options.kind !== defaultStepOptions(step.toolId).kind) {
      issues.push({ step: index, message: `${tool.title} has the wrong kind of settings.` });
      return;
    }
    if (step.options.kind === "ocr" && step.options.output !== "pdf") {
      issues.push({
        step: index,
        message: "Searchable PDF is the only OCR output a workflow can pass on.",
      });
    }
    const confirm =
      confirms[index] ??
      ("password" in step.options ? String(step.options.password) : "");
    if (!optionsReady(step.options, confirm)) {
      issues.push({ step: index, message: `${tool.title}: finish its settings first.` });
    }
  });

  return issues;
}
