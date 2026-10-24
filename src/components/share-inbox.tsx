"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock } from "lucide-react";

import { ToolIcon } from "@/components/tool-icon";
import { toolsForFiles } from "@/lib/file-match";
import { setHandoff } from "@/lib/handoff";
import { takeShared } from "@/lib/share-inbox";
import { formatBytes } from "@/lib/utils";

type LaunchParams = { files: { getFile: () => Promise<File> }[] };
type LaunchWindow = Window & { launchQueue?: { setConsumer: (fn: (params: LaunchParams) => void) => void } };

type State = { status: "waiting" } | { status: "ready"; files: File[] } | { status: "message"; text: string };

const MESSAGES: Record<string, string> = {
  offline:
    "The app was not ready to take the file, so it was turned away unread. Open iHateUpload once from your home screen, then share again.",
  empty: "Nothing came with that share. Share a file, like a PDF or a photo.",
  failed: "The shared file could not be read. Try sharing it again.",
};

/** Files shared from another app or opened with the installed app, with the tools that fit them. */
export function ShareInbox() {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "waiting" });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("id");
    const problem = Object.keys(MESSAGES).find((key) => params.has(key));
    let alive = true;
    const show = (text: string) => void Promise.resolve().then(() => alive && setState({ status: "message", text }));
    if (problem) show(MESSAGES[problem]);
    else if (id) {
      takeShared(id).then(
        (files) =>
          alive &&
          setState(
            files.length
              ? { status: "ready", files }
              : { status: "message", text: "These files were already opened, or the share is older than a day. Share them again." },
          ),
        () => alive && setState({ status: "message", text: "This browser kept no shared files. Share them again." }),
      );
    }
    // "Open with iHateUpload" on a computer hands the files over here.
    const launch = (window as LaunchWindow).launchQueue;
    launch?.setConsumer(async ({ files }) => {
      if (!files?.length) return;
      const opened = await Promise.all(files.map((handle) => handle.getFile()));
      if (alive) setState({ status: "ready", files: opened });
    });
    if (!id && !problem && !launch) show("Share a file to iHateUpload from another app, and it opens here.");
    return () => {
      alive = false;
    };
  }, []);

  const files = useMemo(() => (state.status === "ready" ? state.files : []), [state]);
  const matches = useMemo(() => toolsForFiles(files).slice(0, 10), [files]);
  const total = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div data-testid="share-inbox">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-signal-ink">Shared with iHateUpload</p>
      {state.status === "ready" ? (
        <>
          <h1 className="mt-2 font-display text-4xl font-semibold leading-tight tracking-tight text-ink">What should it become?</h1>
          <ul className="mt-5 space-y-1 text-sm text-ink/70" aria-label="Shared files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex justify-between gap-3">
                <span className="min-w-0 truncate">{f.name}</span>
                <span className="shrink-0 tabular-nums">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3" aria-hidden />
            {files.length === 1 ? "1 file" : `${files.length} files`}, {formatBytes(total)}, kept on this device. Nothing was uploaded.
          </p>
          {matches.length ? (
            <ul className="mt-6 grid gap-2 sm:grid-cols-2">
              {matches.map((tool) => (
                <li key={tool.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setHandoff({ files, from: "home" });
                      router.push(`/tools/${tool.slug}`);
                    }}
                    className="pressable group flex w-full items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 text-left ring-1 ring-ink/6 hover:bg-ink/[0.06]"
                  >
                    <ToolIcon id={tool.id} className="size-8" />
                    <span className="flex-1 text-sm font-semibold">{tool.shortTitle}</span>
                    <ArrowRight className="size-4 text-ink/40" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-6 text-ink/70">No tool opens this kind of file yet.</p>
          )}
        </>
      ) : (
        <p className="mt-3 max-w-xl text-lg text-ink/80" role="status">
          {state.status === "waiting" ? "Opening the shared files…" : state.text}
        </p>
      )}
    </div>
  );
}
