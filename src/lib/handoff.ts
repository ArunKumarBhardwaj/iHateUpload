import type { ToolId } from "@/lib/tools";

type Handoff = { files: File[]; from: ToolId };

let pending: Handoff | null = null;

export function setHandoff(handoff: Handoff) {
  pending = handoff;
}

export function takeHandoff(): Handoff | null {
  const next = pending;
  pending = null;
  return next;
}
