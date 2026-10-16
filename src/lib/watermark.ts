import type {
  AnnotatePosition,
  WatermarkLayout,
  WatermarkSize,
} from "@/lib/tool-options";

export type WatermarkStyle = {
  size: WatermarkSize;
  rotation: number;
  position: AnnotatePosition;
  layout: WatermarkLayout;
};

export type Stamp = {
  /** Where the text's bottom-left corner goes (pdf-lib rotates around it). */
  x: number;
  y: number;
  size: number;
  rotation: number;
};

const SIZE_POINTS: Record<Exclude<WatermarkSize, "fit">, number> = {
  small: 20,
  medium: 36,
  large: 64,
};

const MARGIN = 22;
/** Cap height of Helvetica Bold as a share of the font size. */
const CAP = 0.72;

/** `#rrggbb` to 0-1 channels. Anything else is the default grey. */
export function parseHexColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0x6b / 255, 0x72 / 255, 0x80 / 255];
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Font size in points. Fit makes the text run most of the way across the page along its own angle. */
export function watermarkFontSize(
  size: WatermarkSize,
  rotation: number,
  widthAtOne: number,
  pageWidth: number,
  pageHeight: number,
): number {
  if (size !== "fit") return SIZE_POINTS[size];
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const run = Math.min(
    cos < 1e-6 ? Infinity : pageWidth / cos,
    sin < 1e-6 ? Infinity : pageHeight / sin,
  );
  return Math.max(8, Math.min(400, (run * 0.8) / Math.max(widthAtOne, 0.01)));
}

/** Bottom-left origin that puts the middle of the text box on (cx, cy). */
function originFor(
  cx: number,
  cy: number,
  textWidth: number,
  size: number,
  rotation: number,
) {
  const rad = (rotation * Math.PI) / 180;
  const dx = textWidth / 2;
  const dy = (size * CAP) / 2;
  return {
    x: cx - (dx * Math.cos(rad) - dy * Math.sin(rad)),
    y: cy - (dx * Math.sin(rad) + dy * Math.cos(rad)),
  };
}

function anchor(
  position: AnnotatePosition,
  width: number,
  height: number,
  textWidth: number,
  size: number,
) {
  const half = (size * CAP) / 2;
  switch (position) {
    case "center":
    case "diagonal":
      return { x: width / 2, y: height / 2 };
    case "header":
      return { x: width / 2, y: height - MARGIN - half };
    case "footer":
      return { x: width / 2, y: MARGIN + half };
    case "tl":
      return { x: MARGIN + textWidth / 2, y: height - MARGIN - half };
    case "tr":
      return { x: width - MARGIN - textWidth / 2, y: height - MARGIN - half };
    case "bl":
      return { x: MARGIN + textWidth / 2, y: MARGIN + half };
    case "br":
      return { x: width - MARGIN - textWidth / 2, y: MARGIN + half };
  }
}

/**
 * Every stamp for one page. `widthOf(size)` is the text width at that size.
 * Tiles sit on a staggered grid so rotated text still covers the corners.
 */
export function watermarkStamps(
  style: WatermarkStyle,
  pageWidth: number,
  pageHeight: number,
  widthOf: (size: number) => number,
): Stamp[] {
  const size = watermarkFontSize(
    style.size,
    style.rotation,
    widthOf(1),
    pageWidth,
    pageHeight,
  );
  const textWidth = widthOf(size);

  if (style.layout === "single") {
    const at = anchor(style.position, pageWidth, pageHeight, textWidth, size);
    return [
      {
        ...originFor(at.x, at.y, textWidth, size, style.rotation),
        size,
        rotation: style.rotation,
      },
    ];
  }

  // A fit-sized tile would fill the page by itself, so tile at a readable size.
  const tileSize = style.size === "fit" ? SIZE_POINTS.medium : size;
  const tileWidth = widthOf(tileSize);
  const stepX = tileWidth + tileSize * 2;
  const stepY = tileSize * 3;
  const stamps: Stamp[] = [];
  // A lattice in the text's own frame, so rotated tiles never run into each other.
  const rad = (style.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const reach = Math.hypot(pageWidth, pageHeight);
  const cols = Math.ceil(reach / stepX) + 1;
  const rows = Math.ceil(reach / stepY) + 1;
  for (let row = -rows; row <= rows; row++) {
    const shift = Math.abs(row) % 2 === 0 ? 0 : stepX / 2;
    for (let col = -cols; col <= cols; col++) {
      const u = col * stepX + shift;
      const v = row * stepY;
      const cx = pageWidth / 2 + u * cos - v * sin;
      const cy = pageHeight / 2 + u * sin + v * cos;
      if (cx < 0 || cx > pageWidth || cy < 0 || cy > pageHeight) continue;
      stamps.push({
        ...originFor(cx, cy, tileWidth, tileSize, style.rotation),
        size: tileSize,
        rotation: style.rotation,
      });
    }
  }
  return stamps;
}
