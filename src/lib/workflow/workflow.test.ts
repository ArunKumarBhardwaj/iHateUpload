import { describe, expect, test } from "bun:test";

import { CONTINUE_MAP } from "@/lib/continue-map";
import type { FileItem, ResultItem } from "@/lib/job";
import { optionsReady, type ToolOptions } from "@/lib/tool-options";
import type { ToolId } from "@/lib/tools";
import { WORKFLOW_TOOLS, defaultStepOptions, workflowTool } from "@/lib/workflow/catalog";
import {
  runWorkflow,
  uniqueNames,
  type RunEvent,
  type StepRunner,
} from "@/lib/workflow/engine";
import { PRESETS } from "@/lib/workflow/presets";
import {
  decodeWorkflow,
  encodeWorkflow,
  readShareFragment,
  shareFragment,
  stripSecrets,
} from "@/lib/workflow/share";
import { deleteSaved, listSaved, saveWorkflow } from "@/lib/workflow/storage";
import { newStep, validateWorkflow, type WorkflowStep } from "@/lib/workflow/validate";

const pdfFile = (name: string) => new File(["%PDF-fake"], name, { type: "application/pdf" });
const jpgFile = (name: string) => new File(["jpeg"], name, { type: "image/jpeg" });

function result(name: string, type: string, text: string, from = 1): ResultItem {
  const blob = new Blob([text], { type });
  return {
    id: crypto.randomUUID(),
    name,
    size: blob.size,
    blob,
    originalSize: from,
  };
}

const base = (name: string) => name.replace(/\.[^.]+$/, "");

/** Stand-in tools that write their name into the output, so the chain can be read back. */
function fakeRunner(log: { tool: ToolId; names: string[] }[] = []): StepRunner {
  return async (toolId, files: FileItem[], onProgress, options) => {
    log.push({ tool: toolId, names: files.map((f) => f.name) });
    onProgress(0.5);
    const text = async (f: FileItem) => await f.file.text();
    const inputs = await Promise.all(files.map(text));
    switch (toolId) {
      case "merge-pdf":
        return [result("merged.pdf", "application/pdf", `merge(${inputs.join("+")})`)];
      case "image-to-pdf":
        return [result("images.pdf", "application/pdf", `pdf(${inputs.join("+")})`)];
      case "split-pdf":
        return [1, 2, 3].map((n) =>
          result(`${base(files[0].name)}-page-${n}.pdf`, "application/pdf", `split${n}(${inputs[0]})`),
        );
      case "pdf-to-jpg":
        return [1, 2].map((n) =>
          result(`${base(files[0].name)}-${n}.jpg`, "image/jpeg", `jpg${n}(${inputs[0]})`),
        );
      case "protect-pdf": {
        const pw = options.kind === "protect" ? options.password : "";
        return [result(`${base(files[0].name)}-protected.pdf`, "application/pdf", `protect[${pw}](${inputs[0]})`)];
      }
      case "compress-image":
        return [result(files[0].name, "image/jpeg", `cimg(${inputs[0]})`)];
      default:
        return [result(`${base(files[0].name)}-${toolId}.pdf`, "application/pdf", `${toolId}(${inputs[0]})`)];
    }
  };
}

const steps = (...ids: ToolId[]): WorkflowStep[] => ids.map(newStep);

describe("validation", () => {
  test("an empty workflow is rejected", () => {
    expect(validateWorkflow([])[0].step).toBe(-1);
  });

  test("tools that need the page are not allowed", () => {
    for (const id of ["sign-pdf", "edit-pdf", "redact-pdf", "fill-pdf-form", "organize-pdf", "crop-pdf", "compare-pdfs", "ask-pdf", "scan-to-pdf"]) {
      expect(workflowTool(id)).toBeUndefined();
    }
    const issues = validateWorkflow([{ toolId: "sign-pdf", options: { kind: "sign", placements: [] } }]);
    expect(issues[0].message).toContain("cannot run in a workflow");
  });

  test("an image tool cannot follow a PDF-writing step, and the other way round", () => {
    expect(validateWorkflow(steps("compress-pdf", "compress-image"))[0].step).toBe(1);
    expect(validateWorkflow(steps("compress-image", "compress-pdf"))[0].step).toBe(1);
    expect(validateWorkflow(steps("image-to-pdf", "compress-pdf"))).toEqual([]);
    expect(validateWorkflow(steps("pdf-to-jpg", "compress-image"))).toEqual([]);
  });

  test("documents can only start a chain", () => {
    expect(validateWorkflow(steps("word-to-pdf", "compress-pdf"))).toEqual([]);
    expect(validateWorkflow(steps("compress-pdf", "word-to-pdf"))[0].step).toBe(1);
  });

  test("every tool the workflow allows is ordered like the Continue panel does", () => {
    // Anything the Continue panel offers after an allowed tool must also validate here.
    for (const [from, nexts] of Object.entries(CONTINUE_MAP)) {
      const a = workflowTool(from);
      if (!a) continue;
      for (const next of nexts ?? []) {
        const b = workflowTool(next);
        if (!b || b.in === "doc") continue;
        const issues = validateWorkflow([newStep(from as ToolId), newStep(next)]).filter(
          (i) => i.step === 1 && i.message.includes("needs"),
        );
        // The map is by tool kind; where it offers a tool, the output kinds line up.
        if (a.out === b.in) expect(issues).toEqual([]);
      }
    }
  });

  test("incomplete options are reported on their step", () => {
    const issues = validateWorkflow([
      newStep("compress-pdf"),
      { toolId: "header-footer", options: { ...defaultStepOptions("header-footer"), center: "" } as ToolOptions },
    ]);
    expect(issues.map((i) => i.step)).toEqual([1]);
  });

  test("protect needs matching passwords", () => {
    const protect: WorkflowStep = {
      toolId: "protect-pdf",
      options: { ...defaultStepOptions("protect-pdf"), password: "hunter2" } as ToolOptions,
    };
    expect(validateWorkflow([protect], ["nope"])).toHaveLength(1);
    expect(validateWorkflow([protect], ["hunter2"])).toEqual([]);
  });

  test("OCR must write a searchable PDF to chain", () => {
    const ocr: WorkflowStep = {
      toolId: "ocr-pdf",
      options: { ...defaultStepOptions("ocr-pdf"), output: "text" } as ToolOptions,
    };
    expect(validateWorkflow([ocr])).toHaveLength(1);
  });
});

describe("presets", () => {
  test("every built-in preset is a runnable workflow", () => {
    for (const preset of PRESETS) {
      const confirms = preset.steps.map((s) => ("password" in s.options ? String(s.options.password) : undefined));
      // Protect needs a typed password; everything else is complete as shipped.
      const issues = validateWorkflow(preset.steps, confirms).filter(
        (i) => !(preset.steps[i.step]?.toolId === "protect-pdf"),
      );
      expect(issues).toEqual([]);
    }
  });

  test("presets carry no password and use only allowed tools", () => {
    for (const preset of PRESETS) {
      expect(JSON.stringify(preset.steps)).not.toMatch(/"(owner)?[pP]assword":"[^"]/);
      for (const s of preset.steps) expect(workflowTool(s.toolId)).toBeDefined();
    }
  });

  test("every allowlisted tool has default options that do not throw", () => {
    for (const info of WORKFLOW_TOOLS) {
      expect(defaultStepOptions(info.id).kind).toBeTruthy();
      void optionsReady;
    }
  });
});

describe("running", () => {
  test("outputs feed the next step, per file", async () => {
    const log: { tool: ToolId; names: string[] }[] = [];
    const events: RunEvent[] = [];
    const run = await runWorkflow({
      steps: steps("compress-pdf", "strip-metadata"),
      files: [pdfFile("a.pdf"), pdfFile("b.pdf")],
      run: fakeRunner(log),
      onEvent: (e) => events.push(e),
    });
    expect(run.outputs.map((o) => o.name)).toEqual(["a-compress-pdf-strip-metadata.pdf", "b-compress-pdf-strip-metadata.pdf"]);
    expect(await run.outputs[0].blob.text()).toBe("strip-metadata(compress-pdf(%PDF-fake))");
    // The second step read the first step's output name, not the original.
    expect(log.filter((l) => l.tool === "strip-metadata").map((l) => l.names[0]).sort()).toEqual(["a-compress-pdf.pdf", "b-compress-pdf.pdf"]);
    expect(events.filter((e) => e.state === "done")).toHaveLength(4);
  });

  test("merge is many-to-one: it runs once on every file, in order", async () => {
    const log: { tool: ToolId; names: string[] }[] = [];
    const run = await runWorkflow({
      steps: steps("merge-pdf", "compress-pdf"),
      files: [pdfFile("a.pdf"), pdfFile("b.pdf"), pdfFile("c.pdf")],
      run: fakeRunner(log),
    });
    expect(log.filter((l) => l.tool === "merge-pdf")).toHaveLength(1);
    expect(log[0].names).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(log.filter((l) => l.tool === "compress-pdf")).toHaveLength(1);
    expect(run.outputs).toHaveLength(1);
    expect(await run.outputs[0].blob.text()).toBe("compress-pdf(merge(%PDF-fake+%PDF-fake+%PDF-fake))");
    expect(run.lanes.map((l) => l.status)).toEqual(["done", "merged", "merged"]);
    expect(run.lanes[1].mergedInto).toBe(0);
  });

  test("split is one-to-many and the next step runs on every piece", async () => {
    const log: { tool: ToolId; names: string[] }[] = [];
    const run = await runWorkflow({
      steps: steps("split-pdf", "compress-pdf"),
      files: [pdfFile("a.pdf"), pdfFile("b.pdf")],
      run: fakeRunner(log),
    });
    expect(run.outputs).toHaveLength(6);
    expect(log.filter((l) => l.tool === "compress-pdf")).toHaveLength(6);
    expect(run.lanes[0].outputs).toHaveLength(3);
  });

  test("a PDF-to-images step feeds an image step", async () => {
    const run = await runWorkflow({
      steps: steps("pdf-to-jpg", "compress-image"),
      files: [pdfFile("a.pdf")],
      run: fakeRunner(),
    });
    expect(run.outputs.map((o) => o.name)).toEqual(["a-1.jpg", "a-2.jpg"]);
    expect(await run.outputs[0].blob.text()).toBe("cimg(jpg1(%PDF-fake))");
  });

  test("images to PDF joins by default, or runs per image when asked", async () => {
    const joined = await runWorkflow({
      steps: steps("image-to-pdf", "compress-pdf"),
      files: [jpgFile("1.jpg"), jpgFile("2.jpg")],
      run: fakeRunner(),
    });
    expect(joined.outputs).toHaveLength(1);

    const each = await runWorkflow({
      steps: [{ ...newStep("image-to-pdf"), together: false }, newStep("compress-pdf")],
      files: [jpgFile("1.jpg"), jpgFile("2.jpg")],
      run: fakeRunner(),
    });
    expect(each.outputs).toHaveLength(2);
  });

  test("one failing file does not stop the others, and is reported with its step", async () => {
    const inner = fakeRunner();
    const run = await runWorkflow({
      steps: steps("compress-pdf", "strip-metadata"),
      files: [pdfFile("a.pdf"), pdfFile("bad.pdf"), pdfFile("c.pdf")],
      run: async (id, files, p, o) => {
        if (id === "compress-pdf" && files[0].name === "bad.pdf") throw new Error("Corrupt PDF");
        return inner(id, files, p, o);
      },
    });
    expect(run.outputs.map((o) => o.name)).toEqual(["a-compress-pdf-strip-metadata.pdf", "c-compress-pdf-strip-metadata.pdf"]);
    expect(run.lanes[1]).toMatchObject({ status: "failed", step: 0, error: "Corrupt PDF" });
    expect(run.lanes[0].status).toBe("done");
    expect(run.lanes[2].status).toBe("done");
  });

  test("a file the first tool cannot read fails alone", async () => {
    const run = await runWorkflow({
      steps: steps("compress-pdf"),
      files: [pdfFile("a.pdf"), jpgFile("photo.jpg")],
      run: fakeRunner(),
    });
    expect(run.outputs).toHaveLength(1);
    expect(run.lanes[1].status).toBe("failed");
    expect(run.lanes[1].error).toContain("photo.jpg");
  });

  test("a failed file is left out of a merge, and the rest still merge", async () => {
    const inner = fakeRunner();
    const log: string[][] = [];
    const run = await runWorkflow({
      steps: steps("compress-pdf", "merge-pdf"),
      files: [pdfFile("a.pdf"), pdfFile("bad.pdf"), pdfFile("c.pdf")],
      run: async (id, files, p, o) => {
        if (id === "compress-pdf" && files[0].name === "bad.pdf") throw new Error("nope");
        if (id === "merge-pdf") log.push(files.map((f) => f.name));
        return inner(id, files, p, o);
      },
    });
    expect(log).toEqual([["a-compress-pdf.pdf", "c-compress-pdf.pdf"]]);
    expect(run.outputs).toHaveLength(1);
    expect(run.lanes.map((l) => l.status)).toEqual(["done", "failed", "merged"]);
  });

  test("a failing merge fails its rows and reports the error", async () => {
    const run = await runWorkflow({
      steps: steps("merge-pdf"),
      files: [pdfFile("a.pdf"), pdfFile("b.pdf")],
      run: async () => {
        throw new Error("Add at least two PDF files to merge.");
      },
    });
    expect(run.outputs).toHaveLength(0);
    expect(run.lanes.every((l) => l.status === "failed")).toBe(true);
  });

  test("cancel stops before the next file and marks unfinished rows", async () => {
    const controller = new AbortController();
    const inner = fakeRunner();
    const run = await runWorkflow({
      steps: steps("compress-pdf", "strip-metadata"),
      files: [pdfFile("a.pdf"), pdfFile("b.pdf"), pdfFile("c.pdf")],
      concurrency: 1,
      signal: controller.signal,
      run: async (id, files, p, o) => {
        const out = await inner(id, files, p, o);
        if (files[0].name.startsWith("a-compress")) controller.abort();
        return out;
      },
    });
    expect(run.cancelled).toBe(true);
    expect(run.lanes[0].status).toBe("done");
    expect(run.lanes[1].status).toBe("cancelled");
    expect(run.lanes[2].status).toBe("cancelled");
    expect(run.outputs).toHaveLength(1);
  });

  test("never runs more than the concurrency limit at once", async () => {
    let active = 0;
    let peak = 0;
    const inner = fakeRunner();
    await runWorkflow({
      steps: steps("compress-pdf"),
      files: Array.from({ length: 8 }, (_, i) => pdfFile(`f${i}.pdf`)),
      concurrency: 2,
      run: async (id, files, p, o) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return inner(id, files, p, o);
      },
    });
    expect(peak).toBe(2);
  });

  test("an invalid workflow does not start", async () => {
    await expect(
      runWorkflow({ steps: steps("compress-pdf", "compress-image"), files: [pdfFile("a.pdf")], run: fakeRunner() }),
    ).rejects.toThrow();
  });

  test("zip names stay unique", () => {
    expect(uniqueNames(["a.pdf", "a.pdf", "b.pdf", "a.pdf"])).toEqual(["a.pdf", "a-2.pdf", "b.pdf", "a-3.pdf"]);
  });
});

describe("share links and saved workflows", () => {
  const withPassword: WorkflowStep[] = [
    newStep("merge-pdf"),
    { toolId: "compress-pdf", options: { kind: "compress", level: "heavy", targetKb: 300 } },
    {
      toolId: "protect-pdf",
      options: {
        ...defaultStepOptions("protect-pdf"),
        password: "s3cret-pass",
        ownerPassword: "owner-s3cret",
        allowPrint: false,
      } as ToolOptions,
    },
    { toolId: "unlock-pdf", options: { kind: "unlock", password: "old-secret", lock: "unknown" } },
  ];

  test("steps and options survive a round trip", () => {
    const back = decodeWorkflow(encodeWorkflow(withPassword));
    expect(back).not.toBeNull();
    expect(back!.map((s) => s.toolId)).toEqual(["merge-pdf", "compress-pdf", "protect-pdf", "unlock-pdf"]);
    expect(back![1].options).toEqual({ kind: "compress", level: "heavy", targetKb: 300 });
    expect(back![2].options).toMatchObject({ allowPrint: false });
  });

  test("passwords are stripped from the link", () => {
    const payload = encodeWorkflow(withPassword);
    const raw = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    for (const secret of ["s3cret-pass", "owner-s3cret", "old-secret"]) {
      expect(raw).not.toContain(secret);
      expect(shareFragment(withPassword)).not.toContain(secret);
    }
    const back = decodeWorkflow(payload)!;
    expect(back[2].options).toMatchObject({ password: "", ownerPassword: "" });
    expect(back[3].options).toMatchObject({ password: "" });
  });

  test("stripSecrets does not change the original", () => {
    const original = { kind: "protect", password: "x", nested: { ownerPassword: "y" } };
    const clean = stripSecrets(original);
    expect(clean).toEqual({ kind: "protect", password: "", nested: { ownerPassword: "" } });
    expect(original.password).toBe("x");
  });

  test("the together choice round-trips", () => {
    const back = decodeWorkflow(encodeWorkflow([{ ...newStep("image-to-pdf"), together: false }]))!;
    expect(back[0].together).toBe(false);
  });

  test("the fragment form reads back", () => {
    const back = readShareFragment(shareFragment(steps("compress-pdf", "strip-metadata")));
    expect(back?.map((s) => s.toolId)).toEqual(["compress-pdf", "strip-metadata"]);
    expect(readShareFragment("#w=@@@")).toBeNull();
    expect(readShareFragment("")).toBeNull();
  });

  test("a link naming a tool that needs the page is refused", () => {
    const bad = btoa(JSON.stringify({ v: 1, s: [["sign-pdf", { kind: "sign", placements: [] }]] }));
    expect(decodeWorkflow(bad)).toBeNull();
  });

  test("a hand-edited link cannot add fields or change types", () => {
    const evil = btoa(
      JSON.stringify({
        v: 1,
        s: [["compress-pdf", { kind: "compress", level: { x: 1 }, targetKb: "big", extra: "<script>", __proto__: { polluted: true } }]],
      }),
    );
    const back = decodeWorkflow(evil)!;
    expect(back[0].options).toEqual({ kind: "compress", level: "light", targetKb: null });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("garbage and oversize links return null", () => {
    expect(decodeWorkflow("not base64 !!")).toBeNull();
    expect(decodeWorkflow(btoa("{}"))).toBeNull();
    const many = btoa(JSON.stringify({ v: 1, s: Array.from({ length: 40 }, () => ["compress-pdf", {}]) }));
    expect(decodeWorkflow(many)).toBeNull();
  });

  test("saved workflows keep no password and can be deleted", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    const list = saveWorkflow(storage, "Lock it", withPassword);
    expect(list).toHaveLength(1);
    expect([...mem.values()].join("")).not.toContain("s3cret");
    expect(JSON.stringify(mem)).not.toContain("old-secret");
    const again = saveWorkflow(storage, "Lock it", steps("compress-pdf"));
    expect(again).toHaveLength(1);
    expect(listSaved(storage)).toHaveLength(1);
    expect(deleteSaved(storage, again[0].id)).toEqual([]);
    expect(listSaved(undefined)).toEqual([]);
  });
});
