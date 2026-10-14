import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

import type { Anchor, PageLink } from "./lines";
import type { DocProperties } from "./model";

/** A heading the PDF's outline lists: how deep it sits (0 is top level) and where it points. */
export type OutlineEntry = { title: string; level: number; anchor: Anchor };

type Dest = string | unknown[] | null | undefined;

/** Bookmark names Word accepts: letters, digits and underscores, starting with a letter, at most 40 long. */
export function bookmarkName(raw: string): string {
  let name = raw.replace(/[^A-Za-z0-9_]/g, "_");
  if (!/^[A-Za-z]/.test(name)) name = `b${name}`;
  if (name.length > 40) {
    let hash = 0;
    for (const ch of raw) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    name = `${name.slice(0, 31)}_${hash.toString(36).slice(0, 8)}`;
  }
  return name;
}

/** Turns PDF destinations (named, or page + position) into places in the Word document. */
export function createResolver(pdf: PDFDocumentProxy) {
  const heights = new Map<number, number>();
  const heightOf = async (index: number) => {
    let h = heights.get(index);
    if (h === undefined) {
      const view = (await pdf.getPage(index + 1)).view;
      h = view[3] - view[1];
      heights.set(index, h);
    }
    return h;
  };
  return async (dest: Dest): Promise<Anchor | null> => {
    try {
      let name: string | null = null;
      let explicit: unknown = dest;
      if (typeof dest === "string") {
        name = dest;
        explicit = await pdf.getDestination(dest);
      }
      if (!Array.isArray(explicit) || !explicit.length) return null;
      const target = explicit[0];
      const page = typeof target === "number" ? target : await pdf.getPageIndex(target as never);
      const kind = (explicit[1] as { name?: string } | undefined)?.name;
      const raw = kind === "XYZ" ? explicit[3] : kind === "FitH" || kind === "FitBH" ? explicit[2] : null;
      const y = typeof raw === "number" ? (await heightOf(page)) - raw : 0;
      return { name: bookmarkName(name ?? `dest_p${page + 1}_${Math.round(y)}`), page, y: Math.max(0, y) };
    } catch {
      return null;
    }
  };
}

export type Resolver = ReturnType<typeof createResolver>;

/** Link annotations of a page as rectangles in points from the top left. */
export async function readLinks(page: PDFPageProxy, resolve: Resolver): Promise<PageLink[]> {
  const view = page.getViewport({ scale: 1 });
  const out: PageLink[] = [];
  for (const a of await page.getAnnotations({ intent: "display" })) {
    if (a.subtype !== "Link" || !Array.isArray(a.rect)) continue;
    const [a1, b1, c1, d1, e1, f1] = view.transform;
    const [rx0, ry0, rx1, ry1] = a.rect as [number, number, number, number];
    const [x0, y0] = [a1 * rx0 + c1 * ry0 + e1, b1 * rx0 + d1 * ry0 + f1];
    const [x1, y1] = [a1 * rx1 + c1 * ry1 + e1, b1 * rx1 + d1 * ry1 + f1];
    const box = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
    if (typeof a.url === "string" && a.url) out.push({ ...box, url: a.url });
    else if (a.dest) {
      const anchor = await resolve(a.dest);
      if (anchor) out.push({ ...box, anchor });
    }
  }
  return out;
}

export async function readOutline(pdf: PDFDocumentProxy, resolve: Resolver): Promise<OutlineEntry[]> {
  type Node = { title?: string; dest?: Dest; items?: Node[] };
  let tree: Node[] | null = null;
  try {
    tree = (await pdf.getOutline()) as Node[] | null;
  } catch {
    return [];
  }
  const out: OutlineEntry[] = [];
  const walk = async (nodes: Node[], level: number) => {
    for (const node of nodes) {
      const anchor = node.dest ? await resolve(node.dest) : null;
      const title = (node.title ?? "").replace(/\s+/g, " ").trim();
      if (anchor && title) out.push({ title, level, anchor });
      if (node.items?.length) await walk(node.items, level + 1);
    }
  };
  await walk(tree ?? [], 0);
  return out;
}

/** PDF dates look like D:20240305102030+01'00'. */
export function pdfDate(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(Z|[+-]\d{2}'?(?:\d{2})?'?)?/.exec(raw.trim());
  if (!m) return undefined;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", s = "00", zone = "Z"] = m;
  let offset = "Z";
  const z = /^([+-])(\d{2})'?(\d{2})?/.exec(zone);
  if (z && !(z[2] === "00" && (z[3] ?? "00") === "00")) offset = `${z[1]}${z[2]}:${z[3] ?? "00"}`;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().replace(/\.\d+Z$/, "Z");
}

export async function readProperties(pdf: PDFDocumentProxy): Promise<DocProperties> {
  try {
    const info = ((await pdf.getMetadata()) as unknown as { info?: Record<string, unknown> }).info ?? {};
    const text = (k: string) => {
      const v = info[k];
      return typeof v === "string" && v.trim() ? v.trim() : undefined;
    };
    return {
      title: text("Title"),
      author: text("Author"),
      subject: text("Subject"),
      keywords: text("Keywords"),
      created: pdfDate(info.CreationDate),
      modified: pdfDate(info.ModDate),
    };
  } catch {
    return {};
  }
}
