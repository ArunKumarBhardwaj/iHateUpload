import { encodeJbig2 } from "@/lib/jbig2-encode";
import { encodeJbig2Symbols } from "@/lib/jbig2-symbols";

/**
 * The smaller of a plain generic region and, when lossy matching is allowed,
 * a symbol-dictionary encoding. Lossless callers always get every pixel back.
 */
export function encodeJbig2Best(
  ink: Uint8Array,
  width: number,
  height: number,
  lossy: boolean,
): Uint8Array {
  const generic = encodeJbig2(ink, width, height);
  if (!lossy) return generic;
  const symbols = encodeJbig2Symbols(ink, width, height);
  return symbols && symbols.length < generic.length ? symbols : generic;
}
