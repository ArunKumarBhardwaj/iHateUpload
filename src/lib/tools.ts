export type ToolId = "heic-to-jpg" | "compress-image" | "image-to-pdf";

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
};

export const TOOLS: ToolDefinition[] = [
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
    seoTitle: "HEIC to JPG Converter — Free, No Upload | iHateUpload",
    seoDescription:
      "Convert HEIC to JPG online without uploading. Files stay on your device. Free, unlimited, no watermark.",
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
    seoTitle: "Compress Image Online — Free, No Upload | iHateUpload",
    seoDescription:
      "Compress images in your browser. No upload, no daily limits, no watermark.",
  },
  {
    id: "image-to-pdf",
    slug: "image-to-pdf",
    title: "Image to PDF",
    shortTitle: "Image → PDF",
    description:
      "Turn JPG or PNG photos into a single PDF. Runs entirely on your device.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    actionLabel: "Create PDF",
    seoTitle: "JPG to PDF Converter — Free, No Upload | iHateUpload",
    seoDescription:
      "Convert images to PDF in your browser. Files never leave your device.",
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
