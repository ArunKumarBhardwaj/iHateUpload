export type ToolOptions =
  | { kind: "none" }
  | { kind: "password"; password: string }
  | { kind: "password-confirm"; password: string }
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "organize"; pageOrder: number[] }
  | { kind: "resize"; maxEdge: number };
