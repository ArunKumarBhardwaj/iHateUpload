import type { ToolDefinition } from "@/lib/tools";

export type ToolOptions =
  | { kind: "none" }
  | { kind: "password"; password: string }
  | { kind: "password-confirm"; password: string }
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "organize"; pageOrder: number[] }
  | { kind: "resize"; maxEdge: number };

export const RESIZE_PRESETS = [1920, 1280, 800, 640] as const;
export const RESIZE_MIN = 16;
export const RESIZE_MAX = 10000;

/**
 * Options carry their own kind, so `tool.ui` is only read here. Everything
 * downstream switches on the options themselves and cannot drift from the tool.
 */
export function initialOptions(ui: ToolDefinition["ui"]): ToolOptions {
  switch (ui) {
    case "none":
      return { kind: "none" };
    case "password":
      return { kind: "password", password: "" };
    case "password-confirm":
      return { kind: "password-confirm", password: "" };
    case "rotate":
      return { kind: "rotate", degrees: 90 };
    case "organize":
      return { kind: "organize", pageOrder: [] };
    case "resize":
      return { kind: "resize", maxEdge: 1280 };
  }
}

/**
 * Whether the options are complete enough to run. `confirmPassword` is the
 * retyped value from the form; only `password-confirm` reads it.
 */
export function optionsReady(
  options: ToolOptions,
  confirmPassword: string,
): boolean {
  switch (options.kind) {
    case "none":
    case "rotate":
      return true;
    case "password":
      return options.password.trim().length > 0;
    case "password-confirm":
      return (
        options.password.trim().length > 0 &&
        options.password === confirmPassword
      );
    case "organize":
      return options.pageOrder.length >= 1;
    case "resize":
      return (
        Number.isFinite(options.maxEdge) &&
        options.maxEdge >= RESIZE_MIN &&
        options.maxEdge <= RESIZE_MAX
      );
  }
}
