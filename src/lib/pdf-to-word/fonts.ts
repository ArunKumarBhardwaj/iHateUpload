/** PDF font names to something Word will have on a normal machine. */

const KNOWN = [
  "Arial",
  "Calibri",
  "Cambria",
  "Candara",
  "Century Gothic",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Garamond",
  "Georgia",
  "Impact",
  "Palatino Linotype",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
];

export function stripSubset(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, "");
}

export function fontFlags(name: string): { bold: boolean; italic: boolean } {
  const lower = stripSubset(name).toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi(?!.*light)|extrabold/.test(lower),
    italic: /italic|oblique|slanted/.test(lower),
  };
}

/** "ABCDEF+Arial-BoldMT" to "Arial", "TimesNewRomanPS-ItalicMT" to "Times New Roman". */
export function familyName(name: string): string {
  let base = stripSubset(name).split(/[-,]/)[0];
  base = base.replace(/(PS|MT|PSMT)$/, "");
  base = base.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").replace(/([a-z])(\d)/g, "$1 $2").replace(/\s+/g, " ").trim();
  return base;
}

export function wordFont(
  name: string,
  generic?: "serif" | "sans" | "mono",
): string {
  const family = familyName(name);
  const lower = family.toLowerCase().replace(/\s+/g, "");
  const known = KNOWN.find((k) => k.toLowerCase().replace(/\s+/g, "") === lower);
  if (known) return known;
  if (/^helvetica|^arimo|^liberationsans|^dejavusans$/.test(lower)) return "Arial";
  if (/^times|^liberationserif|^tinos/.test(lower)) return "Times New Roman";
  if (/^courier|^liberationmono|^cousine/.test(lower)) return "Courier New";
  if (/mono|courier|consol|code/.test(lower) || generic === "mono") return "Courier New";
  if (/serif|roman|georgia|garamond|palatino|book|minion|caslon/.test(lower) && !/sans/.test(lower)) {
    return "Times New Roman";
  }
  if (generic === "serif") return "Times New Roman";
  return "Arial";
}
