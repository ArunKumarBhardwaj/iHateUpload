export interface PageSpec {
  width: number;
  height: number;
  margin: { top: number; right: number; bottom: number; left: number };
}

const LETTER = { width: 612, height: 792 };
const A4 = { width: 595.28, height: 841.89 };
const DEFAULT_MARGIN = 72;
// Regions that print on Letter; everywhere else uses A4.
const LETTER_REGIONS = new Set(["US", "CA", "MX", "CL", "CO", "VE", "PH", "CR", "GT", "PA", "DO", "SV", "HN", "NI", "PR"]);

export function defaultPageForLocale(locale: string | undefined): { width: number; height: number } {
  if (!locale) return LETTER;
  const region = locale.split(/[-_]/)[1]?.toUpperCase();
  if (!region) return /^en$/i.test(locale) ? LETTER : A4;
  return LETTER_REGIONS.has(region) ? LETTER : A4;
}

const twips = (v: string | undefined) => (v && /^\d+$/.test(v) ? Number(v) / 20 : undefined);
const attr = (xml: string, tag: string, name: string) =>
  new RegExp(`<w:${tag}\\b[^>]*\\bw:${name}="(\\d+)"`).exec(xml)?.[1];

/** Page size and margins from the document's final w:sectPr, else locale defaults. */
export function pageSpecFromDocxXml(xml: string | undefined, locale: string | undefined): PageSpec {
  const base = defaultPageForLocale(locale);
  const spec: PageSpec = {
    ...base,
    margin: { top: DEFAULT_MARGIN, right: DEFAULT_MARGIN, bottom: DEFAULT_MARGIN, left: DEFAULT_MARGIN },
  };
  if (!xml) return spec;
  const sects = xml.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g);
  const sect = sects?.[sects.length - 1];
  if (!sect) return spec;
  const w = twips(attr(sect, "pgSz", "w"));
  const h = twips(attr(sect, "pgSz", "h"));
  if (w && h && w >= 144 && h >= 144 && w <= 2000 && h <= 2000) {
    spec.width = w;
    spec.height = h;
  }
  const clamp = (v: number | undefined, fallback: number) =>
    v === undefined ? fallback : Math.min(Math.max(v, 18), 200);
  spec.margin = {
    top: clamp(twips(attr(sect, "pgMar", "top")), DEFAULT_MARGIN),
    right: clamp(twips(attr(sect, "pgMar", "right")), DEFAULT_MARGIN),
    bottom: clamp(twips(attr(sect, "pgMar", "bottom")), DEFAULT_MARGIN),
    left: clamp(twips(attr(sect, "pgMar", "left")), DEFAULT_MARGIN),
  };
  // keep a usable text area
  if (spec.margin.left + spec.margin.right > spec.width - 100) spec.margin.left = spec.margin.right = DEFAULT_MARGIN / 2;
  if (spec.margin.top + spec.margin.bottom > spec.height - 100) spec.margin.top = spec.margin.bottom = DEFAULT_MARGIN / 2;
  return spec;
}
