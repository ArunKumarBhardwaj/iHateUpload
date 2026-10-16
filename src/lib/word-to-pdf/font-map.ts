import type { Family } from "./model";

/** Map a Word font name to the face we draw it with (metric-compatible where we ship one). */
export function familyForFont(name: string | undefined): Family | undefined {
  if (!name) return undefined;
  if (/calibri|carlito|aptos|candara|corbel|segoe ui/i.test(name)) return "carlito";
  if (/cambria|caladea/i.test(name)) return "caladea";
  if (/courier|consolas|mono|menlo|lucida console|source code|cascadia/i.test(name)) return "mono";
  if (
    /times|georgia|garamond|palatino|book antiqua|bookman|minion|century|baskerville|constantia|serif/i.test(name) &&
    !/sans/i.test(name)
  )
    return "serif";
  return "sans";
}
