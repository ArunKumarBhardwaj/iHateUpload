import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
} from "@cantoo/pdf-lib";

/**
 * PDF/A wants a drawn appearance (/AP /N) on every annotation but links and
 * popups. Viewers invent one for markup that lacks it; here it is written
 * into the file so the archive looks the same everywhere.
 */

const N = PDFName.of;

const nums = (arr: PDFArray | undefined) =>
  (arr?.asArray() ?? []).map((v) => (v instanceof PDFNumber ? v.asNumber() : Number(v.toString())));

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

function colour(annot: PDFDict, key: string, fallback: number[] | null): number[] | null {
  const c = nums(annot.lookupMaybe(N(key), PDFArray));
  return c.length === 1 || c.length === 3 || c.length === 4 ? c : fallback;
}

function colourOp(c: number[], stroke: boolean) {
  const op = c.length === 1 ? "g" : c.length === 3 ? "rg" : "k";
  return `${c.map(f).join(" ")} ${stroke ? op.toUpperCase() : op}`;
}

/** Quad points as [x, y] corners, four per quad. */
function quads(annot: PDFDict): [number, number][][] {
  const q = nums(annot.lookupMaybe(N("QuadPoints"), PDFArray));
  const out: [number, number][][] = [];
  for (let i = 0; i + 7 < q.length; i += 8) {
    out.push([[q[i], q[i + 1]], [q[i + 2], q[i + 3]], [q[i + 4], q[i + 5]], [q[i + 6], q[i + 7]]]);
  }
  return out;
}

const lerp = (a: [number, number], b: [number, number], t: number): [number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

export type AppearanceContext = {
  doc: PDFDocument;
  /** PDF/A-1 has no transparency, so highlights become a marker bar under the words. */
  transparency: boolean;
};

/** Content and resources for one annotation's normal appearance, or null to leave it empty. */
async function draw(
  { doc, transparency }: AppearanceContext,
  annot: PDFDict,
  subtype: string,
  rect: number[],
): Promise<{ ops: string; resources?: Record<string, unknown> } | null> {
  const stroke = colour(annot, "C", [0, 0, 0])!;
  const fill = colour(annot, "IC", null);
  const border = annot.lookupMaybe(N("BS"), PDFDict)?.get(N("W"));
  const width = border instanceof PDFNumber ? border.asNumber() : 1;
  const [x1, y1, x2, y2] = rect;
  switch (subtype) {
    case "/Highlight": {
      const c = colour(annot, "C", [1, 1, 0])!;
      const parts = quads(annot).map(([tl, tr, bl, br]) =>
        transparency
          ? `${f(tl[0])} ${f(tl[1])} m ${f(tr[0])} ${f(tr[1])} l ${f(br[0])} ${f(br[1])} l ${f(bl[0])} ${f(bl[1])} l h f`
          : (() => {
              const top = [lerp(bl, tl, 0.18), lerp(br, tr, 0.18)];
              return `${f(bl[0])} ${f(bl[1])} m ${f(br[0])} ${f(br[1])} l ${f(top[1][0])} ${f(top[1][1])} l ${f(top[0][0])} ${f(top[0][1])} l h f`;
            })(),
      );
      if (!parts.length) return null;
      return {
        ops: `${transparency ? "/GS0 gs " : ""}${colourOp(c, false)} ${parts.join(" ")}`,
        resources: transparency ? { ExtGState: { GS0: { Type: "ExtGState", BM: "Multiply" } } } : undefined,
      };
    }
    case "/Underline":
    case "/StrikeOut":
    case "/Squiggly": {
      const at = subtype === "/StrikeOut" ? 0.5 : 0.08;
      const lines = quads(annot).map(([tl, tr, bl, br]) => {
        const a = lerp(bl, tl, at);
        const b = lerp(br, tr, at);
        const h = Math.hypot(tl[0] - bl[0], tl[1] - bl[1]);
        return `${f(Math.max(0.5, h * 0.06))} w ${f(a[0])} ${f(a[1])} m ${f(b[0])} ${f(b[1])} l S`;
      });
      return lines.length ? { ops: `${colourOp(stroke, true)} ${lines.join(" ")}` } : null;
    }
    case "/Square":
    case "/Circle": {
      const h = width / 2;
      const [a, b, c, d] = [x1 + h, y1 + h, x2 - h, y2 - h];
      const path =
        subtype === "/Square"
          ? `${f(a)} ${f(b)} ${f(c - a)} ${f(d - b)} re`
          : ellipse((a + c) / 2, (b + d) / 2, (c - a) / 2, (d - b) / 2);
      const paint = fill ? (width > 0 ? "B" : "f") : "S";
      return { ops: `${f(width)} w ${colourOp(stroke, true)} ${fill ? colourOp(fill, false) : ""} ${path} ${paint}` };
    }
    case "/Line": {
      const l = nums(annot.lookupMaybe(N("L"), PDFArray));
      if (l.length < 4) return null;
      return { ops: `${f(width)} w ${colourOp(stroke, true)} ${l.slice(0, 4).map(f).join(" ").replace(/^(\S+ \S+) (\S+ \S+)$/, "$1 m $2 l")} S` };
    }
    case "/Ink":
    case "/Polygon":
    case "/PolyLine": {
      const paths =
        subtype === "/Ink"
          ? (annot.lookupMaybe(N("InkList"), PDFArray)?.asArray() ?? []).map((p) => {
              const path = doc.context.lookup(p);
              return nums(path instanceof PDFArray ? path : undefined);
            })
          : [nums(annot.lookupMaybe(N("Vertices"), PDFArray))];
      const ops = paths
        .filter((p) => p.length >= 4)
        .map((p) => {
          let s = `${f(p[0])} ${f(p[1])} m`;
          for (let i = 2; i + 1 < p.length; i += 2) s += ` ${f(p[i])} ${f(p[i + 1])} l`;
          return subtype === "/Polygon" ? `${s} h ${fill ? "B" : "S"}` : `${s} S`;
        });
      if (!ops.length) return null;
      return { ops: `1 J 1 j ${f(width)} w ${colourOp(stroke, true)} ${fill ? colourOp(fill, false) : ""} ${ops.join(" ")}` };
    }
    case "/Text": {
      // A small folded note, like the icon viewers draw.
      const c = colour(annot, "C", [1, 0.85, 0.2])!;
      const s = Math.min(x2 - x1, y2 - y1, 20);
      const [a, b] = [x1, y2 - s];
      return {
        ops: `${colourOp(c, false)} 0 G 0.6 w ${f(a + 0.5)} ${f(b + 0.5)} ${f(s - 1)} ${f(s - 1)} re B ` +
          [0.3, 0.5, 0.7].map((t) => `${f(a + s * 0.2)} ${f(b + s * t)} m ${f(a + s * 0.8)} ${f(b + s * t)} l S`).join(" "),
      };
    }
    case "/FreeText": {
      const raw = annot.lookup(N("Contents"));
      const contents = raw instanceof PDFString || raw instanceof PDFHexString ? raw.decodeText() : "";
      if (!contents.trim()) return null;
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const da = annot.get(N("DA"))?.toString() ?? "";
      const size = Number(/([\d.]+)\s+Tf/.exec(da)?.[1] ?? 10) || 10;
      const safe = contents.replace(/[^ -~ -ÿ\n]/g, "");
      const lines = safe.split("\n").flatMap((line) => wrap(line, (s) => font.widthOfTextAtSize(s, size), x2 - x1 - 4));
      const body = lines
        .map((line, i) => `BT /F0 ${f(size)} Tf ${f(x1 + 2)} ${f(y2 - 2 - size * (i + 1))} Td ${font.encodeText(line).toString()} Tj ET`)
        .join(" ");
      const frame = width > 0 ? `${f(width)} w 0 G ${f(x1 + width / 2)} ${f(y1 + width / 2)} ${f(x2 - x1 - width)} ${f(y2 - y1 - width)} re S ` : "";
      return { ops: `${frame}0 g ${body}`, resources: { Font: { F0: font.ref } } };
    }
    default:
      return null;
  }
}

function wrap(line: string, measure: (s: string) => number, max: number): string[] {
  const words = line.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const w of words) {
    const next = current ? `${current} ${w}` : w;
    if (measure(next) > max && current) {
      out.push(current);
      current = w;
    } else current = next;
  }
  out.push(current);
  return out;
}

function ellipse(cx: number, cy: number, rx: number, ry: number) {
  const k = 0.5523;
  return [
    `${f(cx + rx)} ${f(cy)} m`,
    `${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} c`,
    `${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)} c`,
    `${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} c`,
    `${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)} c`,
  ].join(" ");
}

/** Gives `annot` a normal appearance stream. Returns false when the rectangle is empty. */
export async function addAppearance(ctx: AppearanceContext, annot: PDFDict, subtype: string): Promise<boolean> {
  const rect = nums(annot.lookupMaybe(N("Rect"), PDFArray));
  if (rect.length < 4) return false;
  const [x1, y1, x2, y2] = [Math.min(rect[0], rect[2]), Math.min(rect[1], rect[3]), Math.max(rect[0], rect[2]), Math.max(rect[1], rect[3])];
  const drawn = await draw(ctx, annot, subtype, [x1, y1, x2, y2]);
  const doc = ctx.doc;
  const stream = doc.context.stream(drawn?.ops ?? "", {
    Type: "XObject",
    Subtype: "Form",
    BBox: [x1, y1, x2, y2],
    Resources: (drawn?.resources ?? {}) as never,
  });
  annot.set(N("AP"), doc.context.obj({ N: doc.context.register(stream) }));
  return true;
}
