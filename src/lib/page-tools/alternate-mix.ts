import { PDFDocument } from "@cantoo/pdf-lib";

/** One input file in the mix. `take` pages go out per turn; `reverse` reads it last page first. */
export type MixSource = { pages: number; take: number; reverse: boolean };

/**
 * append: when a file runs out, the others keep taking turns (the longer file's rest follows).
 * stop: end after the last turn in which every file could give its full share.
 */
export type MixLeftover = "append" | "stop";

export type MixStep = { file: number; page: number };

/** The output order as (file, zero-based page) pairs. */
export function planAlternateMix(sources: MixSource[], leftover: MixLeftover): MixStep[] {
  if (sources.length < 2) throw new Error("Add at least two PDF files to mix.");
  for (const s of sources) {
    if (s.pages < 1) throw new Error("One of the files has no pages.");
    if (!Number.isInteger(s.take) || s.take < 1) throw new Error("Pages per turn must be 1 or more.");
  }
  const order = sources.map((s) =>
    Array.from({ length: s.pages }, (_, i) => (s.reverse ? s.pages - 1 - i : i)),
  );
  const cursor = sources.map(() => 0);
  const plan: MixStep[] = [];
  for (;;) {
    const left = (f: number) => order[f].length - cursor[f];
    if (leftover === "stop" && sources.some((s, f) => left(f) < s.take)) break;
    if (sources.every((_, f) => left(f) === 0)) break;
    for (let f = 0; f < sources.length; f++) {
      const n = Math.min(sources[f].take, left(f));
      for (let k = 0; k < n; k++) plan.push({ file: f, page: order[f][cursor[f]++] });
    }
  }
  if (plan.length === 0) throw new Error("Nothing to mix: the files are shorter than one turn.");
  return plan;
}

/** Copies pages unchanged (text, images and link annotations travel with them). */
export async function buildAlternateMix(
  donors: PDFDocument[],
  sources: MixSource[],
  leftover: MixLeftover,
  onProgress?: (ratio: number) => void,
): Promise<PDFDocument> {
  const plan = planAlternateMix(sources, leftover);
  const out = await PDFDocument.create();
  // Copy each donor's used pages once, in plan order, then place them.
  const copied = new Map<string, Awaited<ReturnType<PDFDocument["copyPages"]>>[number]>();
  for (let f = 0; f < donors.length; f++) {
    const used = plan.filter((s) => s.file === f).map((s) => s.page);
    const pages = await out.copyPages(donors[f], used);
    used.forEach((p, i) => copied.set(`${f}:${p}`, pages[i]));
    onProgress?.(((f + 1) / donors.length) * 0.7);
  }
  plan.forEach((step, i) => {
    out.addPage(copied.get(`${step.file}:${step.page}`)!);
    onProgress?.(0.7 + ((i + 1) / plan.length) * 0.3);
  });
  return out;
}
