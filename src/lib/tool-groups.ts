import type { ToolId } from "@/lib/tools";

/**
 * The catalog by the chore someone came to do, in their words. Every tool
 * sits in exactly one group; the test keeps it that way as tools are added.
 */
export const TOOL_GROUPS: { id: string; title: string; tools: ToolId[] }[] = [
  {
    id: "smaller",
    title: "Make it smaller",
    tools: ["compress-pdf", "compress-image", "compress-to-size"],
  },
  {
    id: "photo",
    title: "Fix a photo",
    tools: ["crop-image", "rotate-image", "resize-image"],
  },
  {
    id: "to-pdf",
    title: "Turn it into a PDF",
    tools: [
      "image-to-pdf",
      "png-to-pdf",
      "heic-to-pdf",
      "scan-to-pdf",
      "word-to-pdf",
      "excel-to-pdf",
      "pptx-to-pdf",
      "markdown-to-pdf",
      "csv-to-pdf",
      "html-to-pdf",
    ],
  },
  {
    id: "format",
    title: "Change the format",
    tools: [
      "pdf-to-jpg",
      "pdf-to-png",
      "pdf-to-word",
      "pdf-to-pptx",
      "pdf-to-excel",
      "heic-to-jpg",
      "webp-to-jpg",
      "png-to-jpg",
      "jpg-to-png",
      "jpg-to-webp",
      "extract-images",
    ],
  },
  {
    id: "pages",
    title: "Arrange pages",
    tools: [
      "merge-pdf",
      "split-pdf",
      "extract-pages",
      "organize-pdf",
      "rotate-pdf",
      "reverse-pages",
      "alternate-mix",
      "delete-blank",
      "repair-pdf",
      "insert-blank",
      "crop-pdf",
      "page-size",
      "n-up",
      "invert-pdf",
    ],
  },
  {
    id: "mark-up",
    title: "Sign and mark up",
    tools: [
      "sign-pdf",
      "fill-pdf-form",
      "edit-pdf",
      "watermark-pdf",
      "page-numbers",
      "bates-numbering",
      "header-footer",
      "flatten-pdf",
    ],
  },
  {
    id: "private",
    title: "Keep it private",
    tools: ["protect-pdf", "unlock-pdf", "redact-pdf", "strip-metadata", "edit-metadata"],
  },
  {
    id: "read",
    title: "Read what’s inside",
    tools: ["ocr-pdf", "extract-text", "compare-pdfs", "ask-pdf"],
  },
];
