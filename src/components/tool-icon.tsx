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
  FileText,
  Image,
  ImageDown,
  Layers,
  ListOrdered,
  Layers2,
  Languages,
  Archive,
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
  Tags,
  Type,
  Unlock,
  TextCursorInput,
  Wrench,
  FileArchive,
  Shuffle,
} from "lucide-react";

import { TOOL_GROUPS } from "@/lib/tool-groups";
import type { ToolId } from "@/lib/tools";
import { cn } from "@/lib/utils";

/**
 * File formats keep the colours people already know from their apps, so a
 * Word → PDF tile reads before its label does.
 */
export const FORMAT = {
  pdf: { color: "#e5322d", Icon: FileText },
  word: { color: "#2b5797", Icon: FileType },
  excel: { color: "#1f7244", Icon: Table },
  ppt: { color: "#d24726", Icon: LayoutGrid },
  jpg: { color: "#f2a516", Icon: Image },
  png: { color: "#0f9b8e", Icon: FileImage },
  webp: { color: "#5b5bd6", Icon: Image },
  heic: { color: "#8b45d9", Icon: Smartphone },
  markdown: { color: "#3c4657", Icon: FileCode },
  csv: { color: "#2f9d55", Icon: FileSpreadsheet },
  html: { color: "#e8692c", Icon: FileCode },
  zip: { color: "#7a5c3e", Icon: FileArchive },
} satisfies Record<string, { color: string; Icon: LucideIcon }>;

export type Format = keyof typeof FORMAT;

/** Each job group owns one colour; action tools wear their group's colour. */
export const GROUP_COLOR: Record<string, string> = {
  compress: "#18975a",
  "to-pdf": "#e5322d",
  "from-pdf": "#f2a516",
  image: "#e59a0b",
  organize: "#ee6b2f",
  edit: "#7c4ddb",
  security: "#2563eb",
  read: "#0e9384",
};

const CONVERT: Partial<Record<ToolId, [Format, Format]>> = {
  "image-to-pdf": ["jpg", "pdf"],
  "png-to-pdf": ["png", "pdf"],
  "heic-to-pdf": ["heic", "pdf"],
  "word-to-pdf": ["word", "pdf"],
  "excel-to-pdf": ["excel", "pdf"],
  "pptx-to-pdf": ["ppt", "pdf"],
  "markdown-to-pdf": ["markdown", "pdf"],
  "csv-to-pdf": ["csv", "pdf"],
  "html-to-pdf": ["html", "pdf"],
  "pdf-to-jpg": ["pdf", "jpg"],
  "pdf-to-png": ["pdf", "png"],
  "pdf-to-word": ["pdf", "word"],
  "pdf-to-pptx": ["pdf", "ppt"],
  "pdf-to-html": ["pdf", "html"],
  "pdf-to-markdown": ["pdf", "markdown"],
  "pdf-to-excel": ["pdf", "excel"],
  "pdf-to-zip": ["pdf", "zip"],
  "heic-to-jpg": ["heic", "jpg"],
  "webp-to-jpg": ["webp", "jpg"],
  "png-to-jpg": ["png", "jpg"],
  "jpg-to-png": ["jpg", "png"],
  "jpg-to-webp": ["jpg", "webp"],
};

const ACTION: Partial<Record<ToolId, LucideIcon>> = {
  "compress-pdf": Minimize2,
  "compress-image": Minimize2,
  "compress-to-size": Scaling,
  "resize-image": Scaling,
  "crop-image": Crop,
  "rotate-image": RotateCw,
  "scan-to-pdf": Camera,
  "extract-images": ImageDown,
  "merge-pdf": Layers,
  "split-pdf": Scissors,
  "extract-pages": FileOutput,
  "organize-pdf": Layers2,
  "rotate-pdf": RotateCw,
  "reverse-pages": ArrowDownUp,
  "alternate-mix": Shuffle,
  "delete-blank": FileX,
  "insert-blank": FilePlus,
  "crop-pdf": Crop,
  "page-size": Proportions,
  "n-up": LayoutGrid,
  "invert-pdf": Contrast,
  "sign-pdf": PenLine,
  "fill-pdf-form": TextCursorInput,
  "repair-pdf": Wrench,
  "edit-pdf": Type,
  "watermark-pdf": Stamp,
  "page-numbers": Hash,
  "header-footer": PanelTop,
  "flatten-pdf": Layers2,
  "pdf-to-pdfa": Archive,
  "protect-pdf": Lock,
  "unlock-pdf": Unlock,
  "redact-pdf": Highlighter,
  "strip-metadata": Eraser,
  "edit-metadata": Tags,
  "bates-numbering": ListOrdered,
  "ocr-pdf": ScanText,
  "extract-text": FileType,
  "compare-pdfs": Columns2,
  "ask-pdf": MessageCircleQuestionMark,
  "translate-pdf": Languages,
};

export function groupOf(id: ToolId) {
  return TOOL_GROUPS.find((group) => group.tools.includes(id));
}

/**
 * One icon family: a soft tile tinted with its colour and a 2px glyph in a
 * deeper shade of it, so every tool reads alike and the colour still carries
 * the job or format. "solid" is the filled variant for small badges.
 */
function Tile({
  color,
  Icon,
  solid = false,
  className,
  iconClassName,
}: {
  color: string;
  Icon: LucideIcon;
  solid?: boolean;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={cn("flex items-center justify-center rounded-[28%]", className)}
      style={
        solid
          ? { backgroundColor: color, color: "#fff" }
          : {
              backgroundColor: `color-mix(in oklab, ${color} 13%, white)`,
              color: `color-mix(in oklab, ${color} 82%, black)`,
              boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 16%, transparent)`,
            }
      }
    >
      <Icon className={cn("size-[52%]", iconClassName)} strokeWidth={2} />
    </span>
  );
}

/**
 * A converter is its source tile with the target stamped on the corner;
 * every other tool is one tile in its job's colour. Size comes from className.
 */
export function ToolIcon({
  id,
  className,
}: {
  id: ToolId;
  className?: string;
  /** Kept for callers; the glyph now scales with the tile. */
  iconClassName?: string;
}) {
  const pair = CONVERT[id];
  if (pair) {
    const [from, to] = pair;
    return (
      <span
        className={cn("relative inline-block size-10 shrink-0", className, "rounded-none bg-transparent")}
        aria-hidden
      >
        <Tile
          color={FORMAT[from].color}
          Icon={FORMAT[from].Icon}
          className="size-full"
        />
        <Tile
          color={FORMAT[to].color}
          Icon={FORMAT[to].Icon}
          solid
          className="absolute -right-[10%] -bottom-[10%] size-[50%] ring-2 ring-card"
          iconClassName="size-[60%]"
        />
      </span>
    );
  }
  const Icon = ACTION[id] ?? FileText;
  const color = GROUP_COLOR[groupOf(id)?.id ?? "to-pdf"];
  return (
    <span className={cn("inline-block size-10 shrink-0", className)} aria-hidden>
      <Tile color={color} Icon={Icon} className="size-full" />
    </span>
  );
}
