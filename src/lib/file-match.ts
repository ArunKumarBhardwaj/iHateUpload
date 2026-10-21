import { TOOLS, type ToolDefinition, type ToolId } from "@/lib/tools";

/** Same rules as an `<input accept>`: extensions, exact types, `type/*`. */
export function acceptsFile(
  accept: string,
  file: { name: string; type: string },
): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return accept
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .some((rule) => {
      if (rule.startsWith(".")) return name.endsWith(rule);
      if (rule.endsWith("/*")) return type.startsWith(rule.slice(0, -1));
      return type === rule;
    });
}

/**
 * What people most often want for each kind of file, first. Anything else
 * that accepts the file follows in catalog order.
 */
const FIRST_CHOICES: ToolId[] = [
  "compress-pdf",
  "merge-pdf",
  "edit-pdf",
  "sign-pdf",
  "organize-pdf",
  "pdf-to-jpg",
  "pdf-to-word",
  "pdf-to-pptx",
  "pdf-to-html",
  "split-pdf",
  "heic-to-jpg",
  "heic-to-pdf",
  "compress-image",
  "image-to-pdf",
  "compress-to-size",
  "resize-image",
  "crop-image",
  "word-to-pdf",
  "excel-to-pdf",
  "pptx-to-pdf",
];

/** Tools that can take every one of these files, best guesses first. */
export function toolsForFiles(
  files: readonly { name: string; type: string }[],
): ToolDefinition[] {
  if (files.length === 0) return [];
  const fits = TOOLS.filter(
    (tool) =>
      (tool.multiple || files.length === 1) &&
      files.every((file) => acceptsFile(tool.accept, file)),
  );
  const rank = (tool: ToolDefinition) => {
    // Two or more PDFs almost always means "make them one".
    if (files.length > 1 && tool.id === "merge-pdf") return -1;
    const index = FIRST_CHOICES.indexOf(tool.id);
    return index === -1 ? FIRST_CHOICES.length : index;
  };
  return fits
    .map((tool, order) => ({ tool, order }))
    .sort((a, b) => rank(a.tool) - rank(b.tool) || a.order - b.order)
    .map(({ tool }) => tool);
}
