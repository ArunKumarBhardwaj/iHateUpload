import { getTool, type ToolDefinition, type ToolId } from "@/lib/tools";

export const CONTINUE_MAP: Partial<Record<ToolId, ToolId[]>> = {
  "merge-pdf": ["compress-pdf", "protect-pdf", "rotate-pdf", "organize-pdf"],
  "compress-pdf": ["protect-pdf", "pdf-to-jpg"],
  "protect-pdf": ["unlock-pdf"],
  "unlock-pdf": ["compress-pdf", "merge-pdf", "organize-pdf"],
  "rotate-pdf": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "organize-pdf": [
    "extract-pages",
    "compress-pdf",
    "protect-pdf",
    "merge-pdf",
    "split-pdf",
  ],
  "extract-pages": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "image-to-pdf": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "png-to-pdf": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "sign-pdf": ["flatten-pdf", "protect-pdf", "compress-pdf"],
  "fill-pdf-form": ["sign-pdf", "protect-pdf", "compress-pdf"],
  "edit-pdf": ["compress-pdf", "protect-pdf", "edit-pdf"],
  "crop-pdf": ["compress-pdf", "protect-pdf"],
  "redact-pdf": ["strip-metadata", "protect-pdf", "compress-pdf"],
  "extract-images": ["compress-image", "resize-image", "image-to-pdf"],
  "header-footer": ["flatten-pdf", "compress-pdf"],
  "reverse-pages": ["compress-pdf", "organize-pdf"],
  // A ZIP is not a PDF, so there is nothing to continue with.
  "pdf-to-zip": [],
  "pdf-to-pdfa": ["protect-pdf", "compress-pdf"],
  "alternate-mix": ["compress-pdf", "organize-pdf", "protect-pdf"],
  "delete-blank": ["compress-pdf", "merge-pdf"],
  "insert-blank": ["compress-pdf", "page-numbers"],
  "invert-pdf": ["compress-pdf", "pdf-to-jpg"],
  "n-up": ["compress-pdf", "pdf-to-jpg"],
  "page-size": ["compress-pdf", "pdf-to-jpg"],
  "pdf-to-png": ["compress-image", "resize-image"],
  "watermark-pdf": ["flatten-pdf", "protect-pdf"],
  "page-numbers": ["flatten-pdf", "compress-pdf"],
  "flatten-pdf": ["protect-pdf", "compress-pdf"],
  "repair-pdf": ["compress-pdf", "organize-pdf", "pdf-to-word"],
  "pdf-to-pptx": ["pptx-to-pdf"],
  "pdf-to-html": ["html-to-pdf"],
  "pdf-to-markdown": ["markdown-to-pdf"],
  "ocr-pdf": ["extract-text", "compress-pdf", "protect-pdf"],
  "word-to-pdf": ["compress-pdf", "protect-pdf"],
  "excel-to-pdf": ["compress-pdf", "protect-pdf"],
  "pptx-to-pdf": ["compress-pdf", "protect-pdf"],
  "markdown-to-pdf": ["compress-pdf", "protect-pdf"],
  "csv-to-pdf": ["compress-pdf", "protect-pdf"],
  "html-to-pdf": ["compress-pdf", "protect-pdf"],
  "scan-to-pdf": ["compress-pdf", "ocr-pdf", "protect-pdf"],
  "strip-metadata": ["protect-pdf", "compress-pdf"],
  "edit-metadata": ["protect-pdf", "compress-pdf"],
  "bates-numbering": ["merge-pdf", "compress-pdf"],
  "heic-to-jpg": ["compress-image", "resize-image", "image-to-pdf"],
  "heic-to-pdf": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "compress-image": ["resize-image", "crop-image", "image-to-pdf"],
  "resize-image": ["compress-image", "crop-image", "image-to-pdf"],
  "pdf-to-jpg": ["compress-image", "resize-image"],
  "webp-to-jpg": ["compress-image", "resize-image", "image-to-pdf"],
  "png-to-jpg": ["compress-image", "resize-image", "image-to-pdf"],
  "jpg-to-png": ["compress-image", "resize-image", "image-to-pdf"],
  "jpg-to-webp": ["compress-image", "resize-image", "image-to-pdf"],
  "crop-image": ["compress-image", "rotate-image", "image-to-pdf"],
  "rotate-image": ["crop-image", "compress-image", "image-to-pdf"],
  "compress-to-size": ["image-to-pdf", "resize-image"],
  "split-pdf": ["merge-pdf", "compress-pdf"],
};

export function resultKinds(results: { type: string }[]): {
  pdf: boolean;
  image: boolean;
} {
  let pdf = false;
  let image = false;
  for (const result of results) {
    if (result.type === "application/pdf") pdf = true;
    if (result.type.startsWith("image/")) image = true;
  }
  return { pdf, image };
}

/** Whether a tool can take results of these kinds: the rule the "Continue with" panel and workflows share. */
export function toolTakesKinds(
  tool: Pick<ToolDefinition, "kind">,
  kinds: { pdf: boolean; image: boolean },
): boolean {
  if (tool.kind === "pdf") return kinds.pdf;
  if (tool.kind === "image") return kinds.image;
  return false;
}

export function continueToolsFor(
  from: ToolId,
  results: { type: string }[],
): ToolDefinition[] {
  const ids = CONTINUE_MAP[from] ?? [];
  const { pdf, image } = resultKinds(results);

  return ids
    .map((id) => getTool(id))
    .filter((tool): tool is ToolDefinition => tool !== undefined)
    .filter((tool) => toolTakesKinds(tool, { pdf, image }));
}
