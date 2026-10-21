import type { ToolOptions } from "@/lib/tool-options";
import type { ToolId } from "@/lib/tools";
import { defaultStepOptions } from "@/lib/workflow/catalog";
import type { WorkflowStep } from "@/lib/workflow/validate";

export type WorkflowPreset = {
  id: string;
  title: string;
  blurb: string;
  /** What the person drops in. */
  input: "pdfs" | "images" | "documents";
  steps: WorkflowStep[];
};

function step(
  toolId: ToolId,
  patch: Record<string, unknown> = {},
  extra: { together?: boolean } = {},
): WorkflowStep {
  return {
    toolId,
    options: { ...defaultStepOptions(toolId), ...patch } as ToolOptions,
    ...extra,
  };
}

/**
 * Built-in chains. None carries a password: Protect starts empty and the
 * person types one before running.
 */
export const PRESETS: WorkflowPreset[] = [
  {
    id: "merge-compress-protect",
    title: "Merge, compress, protect",
    blurb: "Many PDFs into one small, password-locked file.",
    input: "pdfs",
    steps: [
      step("merge-pdf"),
      step("compress-pdf", { level: "medium" }),
      step("protect-pdf"),
    ],
  },
  {
    id: "images-pdf-compress",
    title: "Images to PDF, compressed",
    blurb: "A folder of photos into one small PDF.",
    input: "images",
    steps: [step("image-to-pdf"), step("compress-pdf", { level: "medium" })],
  },
  {
    id: "ocr-compress",
    title: "OCR, then compress",
    blurb: "Make scans searchable, then shrink each file.",
    input: "pdfs",
    steps: [step("ocr-pdf"), step("compress-pdf", { level: "medium" })],
  },
  {
    id: "strip-flatten",
    title: "Strip metadata, then flatten",
    blurb: "Clean author and software traces, then lock form fields in place.",
    input: "pdfs",
    steps: [step("strip-metadata"), step("flatten-pdf")],
  },
  {
    id: "email-ready",
    title: "Email ready",
    blurb: "Shrink every PDF and drop its metadata before you attach it.",
    input: "pdfs",
    steps: [step("compress-pdf", { level: "medium" }), step("strip-metadata")],
  },
  {
    id: "photos-small-jpg",
    title: "Photos to small JPGs",
    blurb: "Resize each image to 1280 px, then compress it.",
    input: "images",
    steps: [step("resize-image", { maxEdge: 1280 }), step("compress-image")],
  },
  {
    id: "pdf-to-pages-small",
    title: "PDF pages to small images",
    blurb: "Every page as a JPG, each compressed.",
    input: "pdfs",
    steps: [step("pdf-to-jpg"), step("compress-image")],
  },
  {
    id: "numbered-print",
    title: "Numbered and compressed",
    blurb: "Page numbers on every page, then compress.",
    input: "pdfs",
    steps: [step("page-numbers"), step("compress-pdf", { level: "medium" })],
  },
];

export function getPreset(id: string): WorkflowPreset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

/** A fresh copy, so editing a loaded preset never edits the built-in. */
export function presetSteps(preset: WorkflowPreset): WorkflowStep[] {
  return structuredClone(preset.steps);
}
