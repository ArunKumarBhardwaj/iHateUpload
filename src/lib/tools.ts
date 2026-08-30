export type ToolId =
  | "image-to-pdf"
  | "merge-pdf"
  | "pdf-to-jpg"
  | "compress-pdf"
  | "split-pdf"
  | "protect-pdf"
  | "unlock-pdf"
  | "rotate-pdf"
  | "organize-pdf"
  | "heic-to-jpg"
  | "heic-to-pdf"
  | "compress-image"
  | "resize-image"
  | "webp-to-jpg"
  | "png-to-jpg"
  | "jpg-to-png";

export type ToolDefinition = {
  id: ToolId;
  slug: ToolId;
  title: string;
  shortTitle: string;
  description: string;
  accept: string;
  multiple: boolean;
  actionLabel: string;
  /** Search-intent title (template appends `| iHateUpload`). */
  seoTitle: string;
  seoDescription: string;
  /** Crawlable how-to steps for the tool page. */
  seoHowTo: [string, string, string];
  showInNav: boolean;
  kind: "image" | "pdf";
  ui: "none" | "password" | "password-confirm" | "rotate" | "organize" | "resize";
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
    seoTitle: "JPG to PDF Converter Free — No Upload",
    seoDescription:
      "Convert JPG, PNG, or WebP to PDF online free. No upload, no signup, no watermark — files stay in your browser.",
    seoHowTo: [
      "Choose one or more JPG, PNG, or WebP images.",
      "Click Create PDF to build the document on this device.",
      "Download your PDF — nothing was uploaded.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
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
    seoTitle: "Merge PDF Online Free — No Upload",
    seoDescription:
      "Merge PDF files online free in your browser. Combine multiple PDFs privately — no upload, no watermark, no signup.",
    seoHowTo: [
      "Add at least two PDF files in the order you want.",
      "Click Merge PDFs to combine them locally.",
      "Download the single merged PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
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
    seoTitle: "PDF to JPG Converter Free — No Upload",
    seoDescription:
      "Convert PDF to JPG online free. Export every page as an image in your browser — no upload, no watermark.",
    seoHowTo: [
      "Drop a PDF file into the workspace.",
      "Click Convert to JPG to render each page locally.",
      "Download the JPG images (or zip when there are many).",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
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
    seoTitle: "Compress PDF Online Free — No Upload",
    seoDescription:
      "Compress PDF online free to shrink file size for email. Private browser compression — no upload, no daily limits.",
    seoHowTo: [
      "Choose the PDF you want to shrink.",
      "Click Compress PDF — processing stays on this device.",
      "Download the smaller PDF when it finishes.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
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
    seoTitle: "Split PDF Online Free — No Upload",
    seoDescription:
      "Split PDF online free into separate pages. Extract pages in your browser — no upload, no signup.",
    seoHowTo: [
      "Choose the PDF you want to split.",
      "Click Split PDF to create one file per page locally.",
      "Download individual pages or grab them all as a zip.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "protect-pdf",
    slug: "protect-pdf",
    title: "Protect PDF",
    shortTitle: "Protect PDF",
    description:
      "Add a password so opening the PDF requires it. Encryption stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    actionLabel: "Protect PDF",
    seoTitle: "Protect PDF with Password Free — No Upload",
    seoDescription:
      "Password-protect a PDF online free. Encrypt PDFs in your browser — no upload, no signup.",
    seoHowTo: [
      "Choose the PDF to protect.",
      "Enter and confirm a password.",
      "Download the encrypted PDF created on this device.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "password-confirm",
  },
  {
    id: "unlock-pdf",
    slug: "unlock-pdf",
    title: "Unlock PDF",
    shortTitle: "Unlock PDF",
    description:
      "Remove password protection from a PDF you can open. Runs locally.",
    accept: "application/pdf,.pdf",
    multiple: true,
    actionLabel: "Unlock PDF",
    seoTitle: "Unlock PDF Online Free — No Upload",
    seoDescription:
      "Unlock PDF online free when you know the password. Remove PDF password in your browser — files stay private.",
    seoHowTo: [
      "Choose a password-protected PDF you can open.",
      "Enter the correct password.",
      "Download the unlocked PDF created locally.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "password",
  },
  {
    id: "rotate-pdf",
    slug: "rotate-pdf",
    title: "Rotate PDF",
    shortTitle: "Rotate PDF",
    description:
      "Rotate every page by 90°, 180°, or 270°. Processing stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    actionLabel: "Rotate PDF",
    seoTitle: "Rotate PDF Online Free — No Upload",
    seoDescription:
      "Rotate PDF pages online free by 90°, 180°, or 270°. Fix sideways scans in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF with pages that need rotating.",
      "Pick 90°, 180°, or 270°.",
      "Download the rotated PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "rotate",
  },
  {
    id: "organize-pdf",
    slug: "organize-pdf",
    title: "Organize PDF",
    shortTitle: "Organize PDF",
    description:
      "Reorder or remove pages, then save a new PDF. Nothing is uploaded.",
    accept: "application/pdf,.pdf",
    multiple: false,
    actionLabel: "Save PDF",
    seoTitle: "Organize PDF Pages Free — No Upload",
    seoDescription:
      "Organize PDF pages online free. Reorder or delete pages in your browser — private and free.",
    seoHowTo: [
      "Choose a PDF to reorganize.",
      "Move or remove pages in the list.",
      "Save and download the new PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "organize",
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
    seoTitle: "HEIC to JPG Converter Free — No Upload",
    seoDescription:
      "Convert HEIC to JPG online free without uploading. iPhone photos stay on your device — unlimited, no watermark.",
    seoHowTo: [
      "Add one or more HEIC or HEIF photos from your iPhone.",
      "Click Convert to JPG — conversion runs in this tab.",
      "Download the JPG files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "heic-to-pdf",
    slug: "heic-to-pdf",
    title: "HEIC to PDF",
    shortTitle: "HEIC → PDF",
    description:
      "Turn iPhone HEIC photos into a PDF for forms and email. Stays on this device.",
    accept: ".heic,.heif,image/heic,image/heif",
    multiple: true,
    actionLabel: "Create PDF",
    seoTitle: "HEIC to PDF Converter Free — No Upload",
    seoDescription:
      "Convert HEIC to PDF online free for forms and email. iPhone photos never leave your browser.",
    seoHowTo: [
      "Add HEIC photos you want in a PDF.",
      "Click Create PDF to build the document locally.",
      "Download the PDF for forms or email.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
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
    seoTitle: "Compress Image Online Free — No Upload",
    seoDescription:
      "Compress image online free for email, WhatsApp, or web. Shrink JPG, PNG, and WebP in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose JPG, PNG, or WebP images to shrink.",
      "Click Compress images — work stays on this device.",
      "Download the compressed files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "resize-image",
    slug: "resize-image",
    title: "Resize Image",
    shortTitle: "Resize",
    description:
      "Scale JPG, PNG, or WebP to a max edge for forms, email, or web. Private.",
    accept: "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    multiple: true,
    actionLabel: "Resize images",
    seoTitle: "Resize Image Online Free — No Upload",
    seoDescription:
      "Resize image online free by max edge. Scale JPG, PNG, or WebP in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose the images to resize.",
      "Pick a max edge size (or enter a custom pixel value).",
      "Download the resized images.",
    ],
    showInNav: true,
    kind: "image",
    ui: "resize",
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
    seoTitle: "WebP to JPG Converter Free — No Upload",
    seoDescription:
      "Convert WebP to JPG online free. Make WebP images work in older apps and forms — no upload, no watermark.",
    seoHowTo: [
      "Add one or more WebP images.",
      "Click Convert to JPG.",
      "Download the JPG files.",
    ],
    showInNav: false,
    kind: "image",
    ui: "none",
  },
  {
    id: "png-to-jpg",
    slug: "png-to-jpg",
    title: "PNG to JPG",
    shortTitle: "PNG → JPG",
    description:
      "Convert PNG images to JPG for smaller files and wider app support.",
    accept: "image/png,.png",
    multiple: true,
    actionLabel: "Convert to JPG",
    seoTitle: "PNG to JPG Converter Free — No Upload",
    seoDescription:
      "Convert PNG to JPG online free for smaller files and wider support. Runs in your browser — no upload.",
    seoHowTo: [
      "Add PNG images to convert.",
      "Click Convert to JPG.",
      "Download the JPG files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
  {
    id: "jpg-to-png",
    slug: "jpg-to-png",
    title: "JPG to PNG",
    shortTitle: "JPG → PNG",
    description:
      "Convert JPG images to PNG when you need lossless pixels or transparency later.",
    accept: "image/jpeg,.jpg,.jpeg",
    multiple: true,
    actionLabel: "Convert to PNG",
    seoTitle: "JPG to PNG Converter Free — No Upload",
    seoDescription:
      "Convert JPG to PNG online free. Keep lossless pixels for editing — no upload, no watermark.",
    seoHowTo: [
      "Add JPG or JPEG images.",
      "Click Convert to PNG.",
      "Download the PNG files.",
    ],
    showInNav: true,
    kind: "image",
    ui: "none",
  },
];

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((tool) => tool.slug === slug);
}
