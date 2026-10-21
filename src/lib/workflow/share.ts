import type { ToolOptions } from "@/lib/tool-options";
import type { ToolId } from "@/lib/tools";
import {
  defaultStepOptions,
  isWorkflowTool,
  workflowTool,
} from "@/lib/workflow/catalog";
import { newStep, type WorkflowStep } from "@/lib/workflow/validate";

/** A share link or a saved workflow never holds more than this many steps. */
export const MAX_STEPS = 12;

const SECRET_KEY = /password|passphrase|secret|token/i;
const UNSAFE_KEY = new Set(["__proto__", "constructor", "prototype"]);

/** Deep copy with every password-like field emptied. Never leaves a secret in a link or in storage. */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSecrets) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (UNSAFE_KEY.has(key)) continue;
      out[key] = SECRET_KEY.test(key)
        ? typeof inner === "string"
          ? ""
          : inner
        : stripSecrets(inner);
    }
    return out as T;
  }
  return value;
}

export function stripStepSecrets(steps: readonly WorkflowStep[]): WorkflowStep[] {
  return steps.map((step) => ({
    ...step,
    options: stripSecrets(step.options),
  }));
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The compact payload of a share link: step tools and options, nothing about files. */
export function encodeWorkflow(steps: readonly WorkflowStep[]): string {
  const payload = {
    v: 1,
    s: stripStepSecrets(steps).map((step) =>
      step.together === undefined
        ? [step.toolId, step.options]
        : [step.toolId, step.options, step.together ? 1 : 0],
    ),
  };
  return toBase64Url(JSON.stringify(payload));
}

/**
 * Only keys the tool's own default options have, and only values of the same
 * type, survive: a hand-made link cannot add fields or swap a string for an object.
 */
function mergeKnown(base: unknown, incoming: unknown): unknown {
  if (Array.isArray(base)) {
    return Array.isArray(incoming) ? incoming.slice(0, 500) : base;
  }
  if (base && typeof base === "object") {
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      return base;
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) {
      const baseValue = (base as Record<string, unknown>)[key];
      const value = (incoming as Record<string, unknown>)[key];
      out[key] =
        value === undefined ? baseValue : mergeKnown(baseValue, value);
    }
    return out;
  }
  if (base === null) {
    return incoming === null || typeof incoming === "number" ? incoming : base;
  }
  return typeof incoming === typeof base ? incoming : base;
}

/** Reads a share payload. Returns null when it is not a workflow this build can run. */
export function decodeWorkflow(payload: string): WorkflowStep[] | null {
  try {
    if (payload.length > 60_000) return null;
    const data: unknown = JSON.parse(fromBase64Url(payload));
    if (!data || typeof data !== "object") return null;
    const { v, s } = data as { v?: unknown; s?: unknown };
    if (v !== 1 || !Array.isArray(s) || s.length === 0 || s.length > MAX_STEPS) {
      return null;
    }
    const steps: WorkflowStep[] = [];
    for (const raw of s) {
      if (!Array.isArray(raw) || typeof raw[0] !== "string") return null;
      const id = raw[0];
      if (!isWorkflowTool(id)) return null;
      const info = workflowTool(id);
      const base = defaultStepOptions(id as ToolId);
      const options = stripSecrets(mergeKnown(base, raw[1])) as ToolOptions;
      const step: WorkflowStep = { toolId: id as ToolId, options };
      if (info?.scope === "choice" && (raw[2] === 0 || raw[2] === 1)) {
        step.together = raw[2] === 1;
      }
      steps.push(step);
    }
    return steps;
  } catch {
    return null;
  }
}

/** The fragment holds the workflow, so it is never sent to a server. */
export function shareFragment(steps: readonly WorkflowStep[]): string {
  return `#w=${encodeWorkflow(steps)}`;
}

export function readShareFragment(hash: string): WorkflowStep[] | null {
  const match = /^#?w=([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? decodeWorkflow(match[1]) : null;
}

export { newStep };
