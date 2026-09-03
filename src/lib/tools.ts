export type ToolId =
  | "image-to-pdf"
  | "merge-pdf"
  | "pdf-to-jpg"
  | "compress-pdf"
  | "split-pdf"
  | "extract-pages"
  | "protect-pdf"
  | "unlock-pdf"
  | "rotate-pdf"
  | "organize-pdf"
  | "sign-pdf"
  | "crop-pdf"
  | "watermark-pdf"
  | "page-numbers"
  | "flatten-pdf"
  | "png-to-pdf"
  | "ocr-pdf"
  | "word-to-pdf"
  | "excel-to-pdf"
  | "strip-metadata"
  | "ask-pdf"
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
  /** Input order changes the output, so the file list offers reordering. */
  ordered: boolean;
  actionLabel: string;
  /** Search-intent title (template appends `| iHateUpload`). */
  seoTitle: string;
  seoDescription: string;
  /** Crawlable how-to steps for the tool page. */
  seoHowTo: [string, string, string];
  showInNav: boolean;
  kind: "image" | "pdf";
  ui:
    | "none"
    | "password"
    | "password-confirm"
    | "rotate"
    | "organize"
    | "resize"
    | "compress"
    | "extract"
    | "sign"
    | "crop"
    | "watermark"
    | "page-numbers"
    | "ocr"
    | "ask";
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
    ordered: true,
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
    id: "png-to-pdf",
    slug: "png-to-pdf",
    title: "PNG to PDF",
    shortTitle: "PNG → PDF",
    description:
      "Turn PNG images into a single PDF. Same local path as Image to PDF.",
    accept: "image/png,.png",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "PNG to PDF Converter Free — No Upload",
    seoDescription:
      "Convert PNG to PDF online free. Build the document in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose one or more PNG images.",
      "Click Create PDF to build the document locally.",
      "Download the PDF.",
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
    ordered: true,
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
    ordered: false,
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
    ordered: false,
    actionLabel: "Compress PDF",
    seoTitle: "Compress PDF Online Free — No Upload",
    seoDescription:
      "Compress PDF online free to shrink file size for email. Light mode keeps text selectable — no upload, no daily limits.",
    seoHowTo: [
      "Choose the PDF you want to shrink.",
      "Pick Light to keep text selectable, or Medium / Smallest for scans.",
      "Download the smaller PDF when it finishes.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "compress",
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
    ordered: false,
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
    id: "extract-pages",
    slug: "extract-pages",
    title: "Extract Pages",
    shortTitle: "Extract Pages",
    description:
      "Pull the pages you want into a new PDF. The rest stays behind. No upload.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Extract pages",
    seoTitle: "Extract PDF Pages Free — No Upload",
    seoDescription:
      "Extract PDF pages online free. Keep only the pages you need in a new file — private, in your browser, no upload.",
    seoHowTo: [
      "Choose the PDF you want pages from.",
      "Type the pages to keep, like 1-3, 7.",
      "Download the new PDF with only those pages.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "extract",
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
    ordered: false,
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
    ordered: false,
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
    ordered: false,
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
    ordered: false,
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
    id: "sign-pdf",
    slug: "sign-pdf",
    title: "Sign PDF",
    shortTitle: "Sign PDF",
    description:
      "Draw, type, or stamp a signature on a page. The ink stays in this tab.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Sign PDF",
    seoTitle: "Sign PDF Online Free — No Upload",
    seoDescription:
      "Sign a PDF online free. Draw, type, or stamp your signature in the browser — no upload, no watermark.",
    seoHowTo: [
      "Choose the PDF you want to sign.",
      "Draw, type, or upload a signature and place it on the page.",
      "Download the signed PDF created on this device.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "sign",
  },
  {
    id: "crop-pdf",
    slug: "crop-pdf",
    title: "Crop PDF",
    shortTitle: "Crop PDF",
    description:
      "Trim margins on every page. The crop box stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Crop PDF",
    seoTitle: "Crop PDF Online Free — No Upload",
    seoDescription:
      "Crop PDF pages online free. Trim margins in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose the PDF you want to crop.",
      "Drag the crop box to the area you want to keep.",
      "Download the cropped PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "crop",
  },
  {
    id: "watermark-pdf",
    slug: "watermark-pdf",
    title: "Watermark PDF",
    shortTitle: "Watermark",
    description:
      "Stamp DRAFT or CONFIDENTIAL across every page. Processing stays here.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Add watermark",
    seoTitle: "Watermark PDF Online Free — No Upload",
    seoDescription:
      "Add a text watermark to a PDF online free. Stamp DRAFT or CONFIDENTIAL in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF to watermark.",
      "Type the stamp and pick position and opacity.",
      "Download the watermarked PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "watermark",
  },
  {
    id: "page-numbers",
    slug: "page-numbers",
    title: "Page Numbers",
    shortTitle: "Page numbers",
    description:
      "Add page numbers to a PDF. The stamp runs in this tab.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Add page numbers",
    seoTitle: "Add Page Numbers to PDF Free — No Upload",
    seoDescription:
      "Add page numbers to a PDF online free. Number pages in your browser — no upload, no watermark.",
    seoHowTo: [
      "Choose the PDF that needs numbers.",
      "Pick where the numbers sit.",
      "Download the numbered PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "page-numbers",
  },
  {
    id: "flatten-pdf",
    slug: "flatten-pdf",
    title: "Flatten PDF",
    shortTitle: "Flatten",
    description:
      "Burn form fields and annotations into the page so they cannot be peeled off.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Flatten PDF",
    seoTitle: "Flatten PDF Online Free — No Upload",
    seoDescription:
      "Flatten a PDF online free. Lock form fields and annotations in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF to flatten.",
      "Click Flatten PDF. Fields become part of the page.",
      "Download the flattened PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "ocr-pdf",
    slug: "ocr-pdf",
    title: "OCR PDF",
    shortTitle: "OCR PDF",
    description:
      "Make a scanned PDF searchable. Tesseract runs in this tab. Slow on long scans.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Make searchable",
    seoTitle: "OCR PDF Online Free — No Upload",
    seoDescription:
      "OCR a PDF online free. Make scanned pages searchable in your browser — no upload, no Premium.",
    seoHowTo: [
      "Choose a scanned or image-only PDF.",
      "Pick the language and run OCR locally.",
      "Download the searchable PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "ocr",
  },
  {
    id: "strip-metadata",
    slug: "strip-metadata",
    title: "Strip Metadata",
    shortTitle: "Strip metadata",
    description:
      "Remove author, titles, and hidden properties from a PDF. Stays on this device.",
    accept: "application/pdf,.pdf",
    multiple: true,
    ordered: false,
    actionLabel: "Strip metadata",
    seoTitle: "Remove PDF Metadata Free — No Upload",
    seoDescription:
      "Strip PDF metadata online free. Remove author and hidden properties in your browser — no upload.",
    seoHowTo: [
      "Choose the PDF to clean.",
      "Click Strip metadata.",
      "Download the cleaned PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "ask-pdf",
    slug: "ask-pdf",
    title: "Ask PDF",
    shortTitle: "Ask PDF",
    description:
      "Ask a question about a PDF. The file stays here. Only extracted text is sent.",
    accept: "application/pdf,.pdf",
    multiple: false,
    ordered: false,
    actionLabel: "Ask",
    seoTitle: "Ask a PDF a Question Free — File Never Uploads",
    seoDescription:
      "Ask questions about a PDF without uploading the file. Text is extracted locally. The PDF never leaves this tab.",
    seoHowTo: [
      "Choose a PDF with selectable text.",
      "Type a question. Only the extracted words are sent.",
      "Read the answer. The PDF itself was never uploaded.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "ask",
  },
  {
    id: "word-to-pdf",
    slug: "word-to-pdf",
    title: "Word to PDF",
    shortTitle: "Word → PDF",
    description:
      "Turn a .docx into a PDF in this tab. Layout is good enough, not Acrobat.",
    accept:
      ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "Word to PDF Converter Free — No Upload",
    seoDescription:
      "Convert Word to PDF online free in your browser. No upload. Layout is simple and private.",
    seoHowTo: [
      "Choose one or more .docx files.",
      "Click Create PDF. Conversion runs locally.",
      "Download the PDF.",
    ],
    showInNav: true,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "excel-to-pdf",
    slug: "excel-to-pdf",
    title: "Excel to PDF",
    shortTitle: "Excel → PDF",
    description:
      "Turn a spreadsheet into a simple PDF table. Runs on this device.",
    accept:
      ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    multiple: true,
    ordered: true,
    actionLabel: "Create PDF",
    seoTitle: "Excel to PDF Converter Free — No Upload",
    seoDescription:
      "Convert Excel to PDF online free in your browser. Spreadsheet stays on your device.",
    seoHowTo: [
      "Choose one or more spreadsheet files.",
      "Click Create PDF to draw a simple table locally.",
      "Download the PDF.",
    ],
    showInNav: false,
    kind: "pdf",
    ui: "none",
  },
  {
    id: "heic-to-jpg",
    slug: "heic-to-jpg",
    title: "HEIC to JPG",
    shortTitle: "HEIC → JPG",
    description:
      "Convert iPhone HEIC photos to JPG in your browser. No upload, no account.",
    accept: ".heic,.heif,.jpg,.jpeg,image/heic,image/heif,image/jpeg",
    multiple: true,
    ordered: false,
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
    accept: ".heic,.heif,.jpg,.jpeg,image/heic,image/heif,image/jpeg",
    multiple: true,
    ordered: true,
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
    ordered: false,
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
    ordered: false,
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
    ordered: false,
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
    ordered: false,
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
    ordered: false,
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
