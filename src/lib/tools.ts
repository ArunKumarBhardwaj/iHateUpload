export type ToolId =
  | "image-to-pdf"
  | "merge-pdf"
  | "pdf-to-jpg"
  | "compress-pdf"
  | "split-pdf"
  | "heic-to-jpg"
  | "compress-image"
  | "webp-to-jpg";

export type ToolDefinition = {
  id: ToolId;
  slug: ToolId;
  title: string;
  shortTitle: string;
  description: string;
  accept: string;
  multiple: boolean;
  actionLabel: string;
  seoTitle: string;
  seoDescription: string;
  showInNav: boolean;
  kind: "image" | "pdf";
};

export const TOOLS: ToolDefinition[] = [
  {
    id: "image-to-pdf",
    slug: "image-to-pdf",
    title: "Image to PDF",
    shortTitle: "JPG → PDF",
    description:
      "Turn JPG or PNG photos into a single PDF. Runs entirely on your device.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    actionLabel: "Create PDF",
    seoTitle: "JPG to PDF Converter — Free, No Upload",
    seoDescription:
      "Convert images to PDF in your browser. Files never leave your device.",
    showInNav: true,
    kind: "image",
  },
  {
    id: "merge-pdf",
    slug: "merge-pdf",
    title: "Merge PDF",
    shortTitle: "Merge PDF",
    description:
      "Combine multiple PDFs into one file. Order stays as you picked. No upload.",
    accept: "application/pdf,.pdf",
    multiple: true,
    actionLabel: "Merge PDFs",
    seoTitle: "Merge PDF Online — Free, No Upload",
    seoDescription:
      "Merge PDF files in your browser. Private, free, no signup, no watermark.",
    showInNav: true,
    kind: "pdf",
  },
  {
    id: "pdf-to-jpg",
    slug: "pdf-to-jpg",
    title: "PDF to JPG",
    shortTitle: "PDF → JPG",
    description:
      "Export every PDF page as a JPG image. Useful for sharing or editing.",
    accept: "application/pdf,.pdf",
    multiple: false,
    actionLabel: "Convert to JPG",
    seoTitle: "PDF to JPG Converter — Free, No Upload",
    seoDescription:
      "Convert PDF pages to JPG in your browser. Files stay on your device.",
    showInNav: true,
    kind: "pdf",
  },
  {
    id: "compress-pdf",
    slug: "compress-pdf",
    title: "Compress PDF",
    shortTitle: "Compress PDF",
    description:
      "Shrink PDF size for email and uploads. Processing stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    actionLabel: "Compress PDF",
    seoTitle: "Compress PDF Online — Free, No Upload",
    seoDescription:
      "Compress PDF files in your browser. No upload, no daily limits.",
    showInNav: true,
    kind: "pdf",
  },
  {
    id: "split-pdf",
    slug: "split-pdf",
    title: "Split PDF",
    shortTitle: "Split PDF",
    description:
      "Split one PDF into a separate file per page. Download what you need.",
    accept: "application/pdf,.pdf",
    multiple: false,
    actionLabel: "Split PDF",
    seoTitle: "Split PDF Online — Free, No Upload",
    seoDescription:
      "Split a PDF into pages in your browser. Private and free.",
    showInNav: false,
    kind: "pdf",
  },
  {
    id: "heic-to-jpg",
    slug: "heic-to-jpg",
    title: "HEIC to JPG",
    shortTitle: "HEIC → JPG",
    description:
      "Convert iPhone HEIC photos to JPG in your browser. No upload, no account.",
    accept: ".heic,.heif,image/heic,image/heif",
    multiple: true,
    actionLabel: "Convert to JPG",
    seoTitle: "HEIC to JPG Converter — Free, No Upload",
    seoDescription:
      "Convert HEIC to JPG online without uploading. Files stay on your device. Free, unlimited, no watermark.",
    showInNav: true,
    kind: "image",
  },
  {
    id: "compress-image",
    slug: "compress-image",
    title: "Compress Image",
    shortTitle: "Compress",
    description:
      "Shrink JPG, PNG, and WebP for email, WhatsApp, or web. Private and free.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    actionLabel: "Compress images",
    seoTitle: "Compress Image Online — Free, No Upload",
    seoDescription:
      "Compress images in your browser. No upload, no daily limits, no watermark.",
    showInNav: false,
    kind: "image",
  },
  {
    id: "webp-to-jpg",
    slug: "webp-to-jpg",
    title: "WebP to JPG",
    shortTitle: "WebP → JPG",
    description:
      "Convert WebP images to JPG so older apps and forms accept them.",
    accept: "image/webp,.webp",
    multiple: true,
    actionLabel: "Convert to JPG",
    seoTitle: "WebP to JPG Converter — Free, No Upload",
    seoDescription:
      "Convert WebP to JPG in your browser. No upload, no watermark.",
    showInNav: false,
    kind: "image",
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
