import { decodeWorkflow, encodeWorkflow, MAX_STEPS } from "@/lib/workflow/share";
import type { WorkflowStep } from "@/lib/workflow/validate";

export type SavedWorkflow = {
  id: string;
  name: string;
  /** Steps in the share encoding, so a password can never be in here. */
  steps: string;
};

const KEY = "ihateupload.workflows.v1";
const MAX_SAVED = 50;

export function listSaved(storage: Pick<Storage, "getItem"> | undefined): SavedWorkflow[] {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(
      (entry): entry is SavedWorkflow =>
        !!entry &&
        typeof entry.id === "string" &&
        typeof entry.name === "string" &&
        typeof entry.steps === "string" &&
        decodeWorkflow(entry.steps) !== null,
    );
  } catch {
    return [];
  }
}

function write(storage: Pick<Storage, "setItem">, list: SavedWorkflow[]) {
  try {
    storage.setItem(KEY, JSON.stringify(list.slice(0, MAX_SAVED)));
    return true;
  } catch {
    return false;
  }
}

/** Saves (or replaces by name) a workflow. Passwords are stripped by the encoding. */
export function saveWorkflow(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  name: string,
  steps: readonly WorkflowStep[],
): SavedWorkflow[] {
  const clean = name.trim().slice(0, 60) || "My workflow";
  if (!storage || steps.length === 0 || steps.length > MAX_STEPS) {
    return listSaved(storage);
  }
  const entry: SavedWorkflow = {
    id: crypto.randomUUID(),
    name: clean,
    steps: encodeWorkflow(steps),
  };
  const list = [entry, ...listSaved(storage).filter((e) => e.name !== clean)];
  write(storage, list);
  return list.slice(0, MAX_SAVED);
}

export function deleteSaved(
  storage: Pick<Storage, "getItem" | "setItem"> | undefined,
  id: string,
): SavedWorkflow[] {
  if (!storage) return [];
  const list = listSaved(storage).filter((e) => e.id !== id);
  write(storage, list);
  return list;
}
