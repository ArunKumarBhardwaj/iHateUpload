import type { LucideIcon } from "lucide-react";
import {
  ArrowDownUp,
  Camera,
  Columns2,
  Contrast,
  Crop,
  Eraser,
  FileImage,
  FileOutput,
  FilePlus,
  FileCode,
  FileSpreadsheet,
  FileType,
  FileX,
  Hash,
  Highlighter,
  Image,
  ImageDown,
  Images,
  Layers,
  Layers2,
  LayoutGrid,
  Lock,
  MessageCircleQuestionMark,
  Minimize2,
  PanelTop,
  PenLine,
  Proportions,
  RotateCw,
  Scaling,
  ScanText,
  Scissors,
  Smartphone,
  Stamp,
  Table,
  Unlock,
} from "lucide-react";

import type { ToolId } from "@/lib/tools";
import { cn } from "@/lib/utils";

type Tone = "rose" | "teal" | "indigo" | "amber" | "slate" | "violet";

const TONE: Record<Tone, string> = {
  rose: "bg-signal/12 text-signal",
  teal: "bg-lagoon/12 text-lagoon",
  indigo: "bg-indigo-500/12 text-indigo-600",
  amber: "bg-amber-500/15 text-amber-700",
  slate: "bg-ink/8 text-ink",
  violet: "bg-violet-500/12 text-violet-600",
};

function visual(id: ToolId): { Icon: LucideIcon; tone: Tone } {
  switch (id) {
    case "merge-pdf":
      return { Icon: Layers, tone: "indigo" };
    case "split-pdf":
      return { Icon: Scissors, tone: "amber" };
    case "compress-pdf":
      return { Icon: Minimize2, tone: "teal" };
    case "extract-pages":
      return { Icon: FileOutput, tone: "indigo" };
    case "protect-pdf":
      return { Icon: Lock, tone: "slate" };
    case "unlock-pdf":
      return { Icon: Unlock, tone: "slate" };
    case "rotate-pdf":
      return { Icon: RotateCw, tone: "amber" };
    case "organize-pdf":
      return { Icon: Layers2, tone: "indigo" };
    case "sign-pdf":
      return { Icon: PenLine, tone: "rose" };
    case "crop-pdf":
      return { Icon: Crop, tone: "amber" };
    case "redact-pdf":
      return { Icon: Highlighter, tone: "rose" };
    case "compare-pdfs":
      return { Icon: Columns2, tone: "indigo" };
    case "extract-text":
      return { Icon: FileType, tone: "teal" };
    case "extract-images":
      return { Icon: ImageDown, tone: "amber" };
    case "header-footer":
      return { Icon: PanelTop, tone: "slate" };
    case "reverse-pages":
      return { Icon: ArrowDownUp, tone: "indigo" };
    case "delete-blank":
      return { Icon: FileX, tone: "amber" };
    case "insert-blank":
      return { Icon: FilePlus, tone: "teal" };
    case "invert-pdf":
      return { Icon: Contrast, tone: "violet" };
    case "n-up":
      return { Icon: LayoutGrid, tone: "indigo" };
    case "page-size":
      return { Icon: Proportions, tone: "amber" };
    case "pdf-to-png":
      return { Icon: FileImage, tone: "amber" };
    case "watermark-pdf":
      return { Icon: Stamp, tone: "violet" };
    case "page-numbers":
      return { Icon: Hash, tone: "slate" };
    case "flatten-pdf":
      return { Icon: Layers2, tone: "slate" };
    case "ocr-pdf":
      return { Icon: ScanText, tone: "teal" };
    case "strip-metadata":
      return { Icon: Eraser, tone: "slate" };
    case "ask-pdf":
      return { Icon: MessageCircleQuestionMark, tone: "teal" };
    case "word-to-pdf":
      return { Icon: FileType, tone: "indigo" };
    case "excel-to-pdf":
      return { Icon: Table, tone: "teal" };
    case "pptx-to-pdf":
      return { Icon: LayoutGrid, tone: "amber" };
    case "markdown-to-pdf":
      return { Icon: FileCode, tone: "indigo" };
    case "csv-to-pdf":
      return { Icon: FileSpreadsheet, tone: "teal" };
    case "html-to-pdf":
      return { Icon: FileCode, tone: "rose" };
    case "scan-to-pdf":
      return { Icon: Camera, tone: "violet" };
    case "pdf-to-jpg":
      return { Icon: Image, tone: "amber" };
    case "png-to-pdf":
      return { Icon: FileImage, tone: "rose" };
    case "image-to-pdf":
      return { Icon: Images, tone: "rose" };
    case "heic-to-jpg":
    case "heic-to-pdf":
      return { Icon: Smartphone, tone: "violet" };
    case "compress-image":
      return { Icon: Minimize2, tone: "teal" };
    case "resize-image":
      return { Icon: Scaling, tone: "amber" };
    case "webp-to-jpg":
    case "png-to-jpg":
    case "jpg-to-png":
    case "jpg-to-webp":
      return { Icon: Image, tone: "rose" };
    case "crop-image":
      return { Icon: Crop, tone: "amber" };
    case "rotate-image":
      return { Icon: RotateCw, tone: "amber" };
    case "compress-to-size":
      return { Icon: Minimize2, tone: "teal" };
  }
}

export function ToolIcon({
  id,
  className,
  iconClassName,
}: {
  id: ToolId;
  className?: string;
  iconClassName?: string;
}) {
  const { Icon, tone } = visual(id);
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-xl",
        TONE[tone],
        className,
      )}
      aria-hidden
    >
      <Icon className={cn("size-5", iconClassName)} />
    </span>
  );
}
