import type { ToolId } from "@/lib/tools";

/**
 * The catalog in the categories people already know from other PDF sites,
 * so a tool is where they'd look for it. Every tool sits in exactly one
 * group; the test keeps it that way as tools are added.
 */
export const TOOL_GROUPS: {
  id: string;
  title: string;
  /** One line under the tab: what's in here, in plain words. */
  description: string;
  tools: ToolId[];
}[] = [
  {
    id: "compress",
    title: "Compress",
    description: "Make PDFs and photos smaller for email, uploads and forms.",
    tools: ["compress-pdf", "compress-image", "compress-to-size"],
  },
  {
    id: "to-pdf",
    title: "Convert to PDF",
    description: "Turn photos, scans, Word, Excel, PowerPoint and more into a PDF.",
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
    id: "from-pdf",
    title: "Convert from PDF",
    description: "Turn a PDF into images, Word, Excel, PowerPoint or a web page.",
    tools: [
      "pdf-to-jpg",
      "pdf-to-png",
      "pdf-to-word",
      "pdf-to-pptx",
      "pdf-to-excel",
      "pdf-to-html",
      "pdf-to-zip",
      "extract-images",
    ],
  },
  {
    id: "image",
    title: "Image tools",
    description: "Crop, rotate and resize photos, or switch between JPG, PNG, WebP and HEIC.",
    tools: [
      "crop-image",
      "rotate-image",
      "resize-image",
      "heic-to-jpg",
      "webp-to-jpg",
      "png-to-jpg",
      "jpg-to-png",
      "jpg-to-webp",
    ],
  },
  {
    id: "organize",
    title: "Organize pages",
    description: "Merge, split, reorder, rotate, add or remove pages.",
    tools: [
      "merge-pdf",
      "split-pdf",
      "extract-pages",
      "organize-pdf",
      "rotate-pdf",
      "reverse-pages",
      "alternate-mix",
      "delete-blank",
      "insert-blank",
      "n-up",
    ],
  },
  {
    id: "edit",
    title: "Edit & sign",
    description: "Change text, sign, fill forms, and add watermarks or page numbers.",
    tools: [
      "edit-pdf",
      "sign-pdf",
      "fill-pdf-form",
      "watermark-pdf",
      "page-numbers",
      "header-footer",
      "bates-numbering",
      "crop-pdf",
      "page-size",
    ],
  },
  {
    id: "security",
    title: "Passwords & privacy",
    description: "Add or remove a password, black out text, and clean hidden info.",
    tools: [
      "protect-pdf",
      "unlock-pdf",
      "redact-pdf",
      "strip-metadata",
      "edit-metadata",
      "flatten-pdf",
    ],
  },
  {
    id: "read",
    title: "Read & repair",
    description: "Make scans searchable, pull out text, compare, ask questions, or fix a broken PDF.",
    tools: [
      "ocr-pdf",
      "extract-text",
      "compare-pdfs",
      "ask-pdf",
      "repair-pdf",
      "invert-pdf",
    ],
  },
];

/** Hashes from the old job names, so /#private and friends still land right. */
export const OLD_GROUP_IDS: Record<string, string> = {
  smaller: "compress",
  photo: "image",
  format: "from-pdf",
  pages: "organize",
  "mark-up": "edit",
  private: "security",
};
