import { getTool, type ToolDefinition, type ToolId } from "@/lib/tools";

const CONTINUE_MAP: Partial<Record<ToolId, ToolId[]>> = {
  "merge-pdf": ["compress-pdf", "protect-pdf", "rotate-pdf", "organize-pdf"],
  "compress-pdf": ["protect-pdf", "pdf-to-jpg"],
  "protect-pdf": ["unlock-pdf"],
  "unlock-pdf": ["compress-pdf", "merge-pdf", "organize-pdf"],
  "rotate-pdf": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "organize-pdf": ["compress-pdf", "protect-pdf", "merge-pdf", "split-pdf"],
  "image-to-pdf": ["compress-pdf", "protect-pdf", "merge-pdf"],
  "heic-to-jpg": ["compress-image", "image-to-pdf"],
  "compress-image": ["image-to-pdf"],
  "pdf-to-jpg": ["compress-image"],
  "webp-to-jpg": ["compress-image", "image-to-pdf"],
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
