import { acceptsFile } from "@/lib/file-match";
import { initialOptions, type ToolOptions } from "@/lib/tool-options";
import { getTool, type ToolDefinition, type ToolId } from "@/lib/tools";

/** What a step reads and writes. Only PDFs and images chain; documents can only start a chain. */
export type StepKind = "pdf" | "image" | "doc";

/**
 * How a step treats a batch.
 * - each: runs once per file, so 20 files give 20 results.
 * - together: takes every file at once and gives one (merge).
 * - choice: either; the person picks, and `together` is the default
 *   (images to PDF: one PDF, like the tool's own page).
 * Split-style tools are `each` too: one file in, several out.
 */
export type StepScope = "each" | "together" | "choice";

export type WorkflowToolInfo = {
  id: ToolId;
  in: StepKind;
  out: StepKind;
  scope: StepScope;
  /** One file in, several files out (split, PDF to images). */
  fanOut?: boolean;
};

const pdf = (id: ToolId, extra: Partial<WorkflowToolInfo> = {}): WorkflowToolInfo => ({
  id,
  in: "pdf",
  out: "pdf",
  scope: "each",
  ...extra,
});
const img = (id: ToolId, extra: Partial<WorkflowToolInfo> = {}): WorkflowToolInfo => ({
  id,
  in: "image",
  out: "image",
  scope: "each",
  ...extra,
});
const doc = (id: ToolId): WorkflowToolInfo => ({
  id,
  in: "doc",
  out: "pdf",
  scope: "each",
});

/**
 * Tools a workflow may run. Each one works from its options alone: nothing
 * that needs a page canvas, a drawn box, a review step or a per-file choice
 * (sign, edit, redact, fill form, organize, crop, edit metadata, compare, ask)
 * is here, because a batch has nobody to answer.
 */
export const WORKFLOW_TOOLS: readonly WorkflowToolInfo[] = [
  // PDF to PDF
  pdf("merge-pdf", { scope: "together" }),
  pdf("compress-pdf"),
  pdf("protect-pdf"),
  pdf("unlock-pdf"),
  pdf("rotate-pdf"),
  pdf("flatten-pdf"),
  pdf("strip-metadata"),
  pdf("repair-pdf"),
  pdf("ocr-pdf"),
  pdf("watermark-pdf"),
  pdf("page-numbers"),
  pdf("bates-numbering"),
  pdf("header-footer"),
  pdf("reverse-pages"),
  pdf("delete-blank"),
  pdf("insert-blank"),
  pdf("invert-pdf"),
  pdf("n-up"),
  pdf("page-size"),
  pdf("split-pdf", { fanOut: true }),
  // PDF to images
  pdf("pdf-to-jpg", { out: "image", fanOut: true }),
  pdf("pdf-to-png", { out: "image", fanOut: true }),
  pdf("extract-images", { out: "image", fanOut: true }),
  // Images
  img("compress-image"),
  img("resize-image"),
  img("compress-to-size"),
  img("rotate-image"),
  img("png-to-jpg"),
  img("jpg-to-png"),
  img("jpg-to-webp"),
  img("webp-to-jpg"),
  img("heic-to-jpg"),
  // Images to PDF
  img("image-to-pdf", { out: "pdf", scope: "choice" }),
  img("png-to-pdf", { out: "pdf", scope: "choice" }),
  img("heic-to-pdf", { out: "pdf", scope: "choice" }),
  // Documents to PDF
  doc("word-to-pdf"),
  doc("excel-to-pdf"),
  doc("pptx-to-pdf"),
  doc("markdown-to-pdf"),
  doc("csv-to-pdf"),
  doc("html-to-pdf"),
];

const BY_ID = new Map<string, WorkflowToolInfo>(
  WORKFLOW_TOOLS.map((info) => [info.id, info]),
);

export function workflowTool(id: string): WorkflowToolInfo | undefined {
  return BY_ID.get(id);
}

export function isWorkflowTool(id: string): id is ToolId {
  return BY_ID.has(id);
}

export function workflowToolDefinition(id: ToolId): ToolDefinition {
  const tool = getTool(id);
  if (!tool) throw new Error(`Unknown tool ${id}`);
  return tool;
}

/** The options a step starts with, the same ones the tool's own page starts with. */
export function defaultStepOptions(id: ToolId): ToolOptions {
  return initialOptions(workflowToolDefinition(id).ui);
}

/** Whether a step with this tool runs on all its files at once, by default. */
export function defaultTogether(info: WorkflowToolInfo): boolean {
  return info.scope !== "each";
}

/** Whether this file can be an input of this tool, by the tool's own accept rules. */
export function fileFitsTool(
  id: ToolId,
  file: { name: string; type: string },
): boolean {
  return acceptsFile(workflowToolDefinition(id).accept, file);
}
