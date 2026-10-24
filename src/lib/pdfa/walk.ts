import { PDFArray, PDFDict, PDFDocument, PDFRef, PDFStream } from "@cantoo/pdf-lib";

/**
 * Deletes every indirect object the catalog and Info dictionary no longer
 * reach. Validators read every object in the file, used or not, so a removed
 * attachment or script must not linger.
 */
export function dropUnreachable(doc: PDFDocument): number {
  const ctx = doc.context;
  const live = new Set<string>();
  const stack: unknown[] = [doc.catalog, ctx.trailerInfo.Root, ctx.trailerInfo.Info];
  const seen = new Set<unknown>();
  while (stack.length) {
    const obj = stack.pop();
    if (obj instanceof PDFRef) {
      if (live.has(obj.toString())) continue;
      live.add(obj.toString());
      stack.push(ctx.lookup(obj));
      continue;
    }
    if (!obj || seen.has(obj)) continue;
    seen.add(obj);
    if (obj instanceof PDFStream) for (const [, v] of obj.dict.entries()) stack.push(v);
    else if (obj instanceof PDFDict) for (const [, v] of obj.entries()) stack.push(v);
    else if (obj instanceof PDFArray) for (const v of obj.asArray()) stack.push(v);
  }
  let dropped = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (!live.has(ref.toString())) {
      ctx.delete(ref);
      dropped++;
    }
  }
  return dropped;
}

/**
 * Every dictionary reachable from `roots` (by default the catalog and the Info
 * dictionary), once each, direct ones included; streams come with their dictionary.
 */
export function reachable(
  doc: PDFDocument,
  roots?: unknown[],
): { dict: PDFDict; stream?: PDFStream }[] {
  const ctx = doc.context;
  const seen = new Set<unknown>();
  const out: { dict: PDFDict; stream?: PDFStream }[] = [];
  const stack: unknown[] = roots ? [...roots] : [doc.catalog, ctx.trailerInfo.Info];
  while (stack.length) {
    let obj = stack.pop();
    if (obj instanceof PDFRef) obj = ctx.lookup(obj);
    if (!obj || seen.has(obj)) continue;
    seen.add(obj);
    if (obj instanceof PDFStream) {
      seen.add(obj.dict);
      out.push({ dict: obj.dict, stream: obj });
      for (const [, v] of obj.dict.entries()) stack.push(v);
    } else if (obj instanceof PDFDict) {
      out.push({ dict: obj });
      for (const [, v] of obj.entries()) stack.push(v);
    } else if (obj instanceof PDFArray) {
      for (const v of obj.asArray()) stack.push(v);
    }
  }
  return out;
}
