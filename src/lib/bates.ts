import { parsePageRange, type AnnotatePosition, type ToolOptions } from "@/lib/tool-options";

type AnnotateOptions = Extract<ToolOptions, { kind: "annotate" }>;

export const BATES_POSITIONS: { id: AnnotatePosition; title: string }[] = [
  { id: "tl", title: "Top left" },
  { id: "header", title: "Top centre" },
  { id: "tr", title: "Top right" },
  { id: "bl", title: "Bottom left" },
  { id: "footer", title: "Bottom centre" },
  { id: "br", title: "Bottom right" },
];

export const BATES_DIGITS_MAX = 12;
export const BATES_SIZE_MIN = 5;
export const BATES_SIZE_MAX = 48;

/** `ABC` + 7 → `ABC000007`. Numbers wider than the padding are never cut. */
export function batesLabel(
  options: Pick<AnnotateOptions, "batesPrefix" | "batesSuffix" | "batesDigits">,
  value: number,
) {
  return `${options.batesPrefix}${String(value).padStart(options.batesDigits, "0")}${options.batesSuffix}`;
}

/** Lower-left corner of the stamp, one margin in from the chosen edge. */
export function batesPlacement(
  position: AnnotatePosition,
  width: number,
  height: number,
  textWidth: number,
  size: number,
  margin: number,
) {
  const top = height - margin - size;
  switch (position) {
    case "tl":
      return { x: margin, y: top };
    case "header":
      return { x: (width - textWidth) / 2, y: top };
    case "tr":
      return { x: width - margin - textWidth, y: top };
    case "bl":
      return { x: margin, y: margin };
    case "br":
      return { x: width - margin - textWidth, y: margin };
    default:
      return { x: (width - textWidth) / 2, y: margin };
  }
}

/** Which pages of one file get a Bates number. */
export function batesPages(options: AnnotateOptions, pageCount: number) {
  const wanted = options.range.trim() === "" ? "all" : options.range;
  return parsePageRange(wanted, pageCount).filter(
    (index) => !(options.skipFirst && index === 0),
  );
}

/** First and last number the set will carry, for the panel's summary. */
export function batesPreview(options: AnnotateOptions, pageCounts: number[]) {
  const pages = pageCounts.reduce(
    (sum, count) => sum + batesPages(options, count).length,
    0,
  );
  if (pages === 0) return { first: "", last: "", pages };
  return {
    first: batesLabel(options, options.startAt),
    last: batesLabel(options, options.startAt + pages - 1),
    pages,
  };
}

export function batesReady(options: AnnotateOptions) {
  return (
    Number.isInteger(options.startAt) &&
    options.startAt >= 0 &&
    Number.isInteger(options.batesDigits) &&
    options.batesDigits >= 1 &&
    options.batesDigits <= BATES_DIGITS_MAX &&
    Number.isFinite(options.batesSize) &&
    options.batesSize >= BATES_SIZE_MIN &&
    options.batesSize <= BATES_SIZE_MAX &&
    Number.isFinite(options.margin) &&
    options.margin >= 0 &&
    // Standard fonts only draw Latin-1; the stamp must survive that.
    /^[\x20-\x7e\xa0-\xff]*$/.test(options.batesPrefix + options.batesSuffix)
  );
}
