import { getTool, type ToolDefinition, type ToolId } from "@/lib/tools";

const CONTINUE_MAP: Partial<Record<ToolId, ToolId[]>> = {
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
  "crop-pdf": ["compress-pdf", "protect-pdf"],
  "redact-pdf": ["strip-metadata", "protect-pdf", "compress-pdf"],
  "watermark-pdf": ["flatten-pdf", "protect-pdf"],
  "page-numbers": ["flatten-pdf", "compress-pdf"],
  "flatten-pdf": ["protect-pdf", "compress-pdf"],
  "ocr-pdf": ["compress-pdf", "protect-pdf"],
  "word-to-pdf": ["compress-pdf", "protect-pdf"],
  "excel-to-pdf": ["compress-pdf", "protect-pdf"],
  "strip-metadata": ["protect-pdf", "compress-pdf"],
  "heic-to-jpg": ["compress-image", "resize-image", "image-to-pdf"],
  "heic-to-pdf": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "compress-image": ["resize-image", "image-to-pdf"],
  "resize-image": ["compress-image", "image-to-pdf"],
  "pdf-to-jpg": ["compress-image", "resize-image"],
  "webp-to-jpg": ["compress-image", "resize-image", "image-to-pdf"],
  "png-to-jpg": ["compress-image", "resize-image", "image-to-pdf"],
  "jpg-to-png": ["compress-image", "resize-image", "image-to-pdf"],
  "split-pdf": ["merge-pdf", "compress-pdf"],
};

function resultKinds(results: { type: string }[]): {
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

export function continueToolsFor(
  from: ToolId,
  results: { type: string }[],
): ToolDefinition[] {
  const ids = CONTINUE_MAP[from] ?? [];
  const { pdf, image } = resultKinds(results);

  return ids
    .map((id) => getTool(id))
    .filter((tool): tool is ToolDefinition => tool !== undefined)
    .filter((tool) => {
      if (tool.kind === "pdf") return pdf;
      if (tool.kind === "image") return image;
      return false;
    });
}
