"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Upload } from "lucide-react";

import { ToolIcon } from "@/components/tool-icon";
import { toolsForFiles } from "@/lib/file-match";
import { setHandoff } from "@/lib/handoff";
import type { ToolDefinition, ToolId } from "@/lib/tools";
import { cn, formatBytes } from "@/lib/utils";

type Group = { id: string; title: string; tools: ToolDefinition[] };

const PROOF = ["Zero bytes uploaded", "Works offline", "No account, no watermark"];

export function HomePage({
  groups,
  toolCount,
}: {
  groups: Group[];
  toolCount: number;
}) {
  const byId = (id: ToolId) =>
    groups.flatMap((group) => group.tools).find((tool) => tool.id === id);

  return (
    <div className="bg-background text-ink">
      {/* Hero: one big promise, then the drop stage does the talking. */}
      <section className="mx-auto max-w-[84rem] px-5 pt-14 sm:px-8 sm:pt-20">
        <h1
          className={cn(
            "font-display max-w-6xl text-[clamp(2.75rem,7.6vw,6.5rem)] leading-[0.92] font-semibold tracking-[-0.045em] text-balance",
          )}
        >
          Edit any file.
          <br />
          <span className="text-ink/35">Nothing leaves this tab.</span>
        </h1>
        <div className="mt-8 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-xl text-lg leading-relaxed text-ink/70">
            {toolCount} PDF and image tools that run on your own device, so
            contracts, IDs and medical records never touch a server.
          </p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {PROOF.map((line) => (
              <li key={line} className="flex items-center gap-1.5 text-sm font-medium">
                <Check className="size-4 text-[#0f766e]" aria-hidden />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <DropStage />
      </section>

      {/* Most used: a bento, so the five big jobs read before the long list. */}
      <section className="mx-auto max-w-[84rem] px-5 pt-24 sm:px-8 sm:pt-32">
        <h2
          className={cn(
            "font-display text-4xl font-semibold tracking-[-0.03em] sm:text-5xl",
          )}
        >
          The ones people reach for
        </h2>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:grid-rows-[15rem_15rem]">
          <BentoTile
            tool={byId("compress-pdf")}
            className="lg:col-span-3 lg:row-span-2"
            art={<CompressArt />}
            big
          />
          <BentoTile
            tool={byId("merge-pdf")}
            className="lg:col-span-3"
            art={<MergeArt />}
          />
          <BentoTile
            tool={byId("sign-pdf")}
            className="lg:col-span-2"
            art={<SignArt />}
          />
          <BentoTile
            tool={byId("heic-to-jpg")}
            className="lg:col-span-1"
            art={null}
            narrow
          />
        </div>
      </section>

      {/* Everything else: a plain directory by job, fast to scan. Footer
          links jump to a job with /#smaller, /#private and so on. */}
      <section id="all-tools" className="scroll-mt-20 mx-auto max-w-[84rem] px-5 pt-24 sm:px-8 sm:pt-32">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2
            className={cn(
                "font-display text-4xl font-semibold tracking-[-0.03em] sm:text-5xl",
            )}
          >
            Every tool, by job
          </h2>
          <Link
            href="/tools/workflow"
            className="pressable inline-flex items-center gap-1.5 text-sm font-semibold underline-offset-4 hover:underline"
          >
            Chain several into a workflow
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="mt-10 grid gap-x-8 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
          {groups.map((group) => (
            <div key={group.id} id={group.id} className="scroll-mt-24">
              <h3 className="flex items-baseline justify-between border-b border-ink/10 pb-3 text-sm font-semibold">
                {group.title}
                <span className="text-xs font-medium text-ink/45 tabular-nums">
                  {group.tools.length}
                </span>
              </h3>
              <ul className="mt-2">
                {group.tools.map((tool) => (
                  <li key={tool.id}>
                    <Link
                      href={`/tools/${tool.slug}`}
                      className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors duration-150 hover:bg-white"
                    >
                      <ToolIcon id={tool.id} className="size-7" />
                      <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                        {tool.title}
                      </span>
                      <ArrowRight
                        className="size-3.5 -translate-x-1 opacity-0 transition-[opacity,transform] duration-200 ease-out group-hover:translate-x-0 group-hover:opacity-60"
                        aria-hidden
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy, said once and plainly. */}
      <section className="mx-auto max-w-[84rem] px-5 py-24 sm:px-8 sm:py-32">
        <div className="grid gap-10 rounded-[2rem] bg-white p-8 ring-1 ring-ink/6 sm:p-12 lg:grid-cols-[1.1fr_2fr]">
          <h2
            className={cn(
                "font-display text-4xl leading-[1] font-semibold tracking-[-0.03em] sm:text-5xl",
            )}
          >
            How it stays private
          </h2>
          <div className="grid gap-8 sm:grid-cols-3">
            {[
              ["Your browser does the work", "Every tool runs on this device, like a calculator app. There is no server to send files to."],
              ["Nothing is sent", "Your file is read in this tab only. It works with Wi-Fi off once the page has loaded."],
              ["Close the tab, it's gone", "No copies, no account, no history. When you close the tab, the file leaves memory."],
            ].map(([title, body]) => (
              <div key={title}>
                <p className="font-semibold">{title}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink/65">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}

/**
 * The drop zone is the hero: a dark stage that plays what the tools do until
 * a file arrives, leans in when one is dragged over, then lists the jobs that
 * fit. Dropping anywhere on the page lands here.
 */
function DropStage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const matches = useMemo(() => toolsForFiles(files).slice(0, 8), [files]);

  useEffect(() => {
    let depth = 0;
    const hasFiles = (event: DragEvent) =>
      event.dataTransfer?.types.includes("Files") ?? false;
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const dropped = event.dataTransfer?.files;
      if (dropped && dropped.length > 0) setFiles(Array.from(dropped));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  const total = files.reduce((sum, file) => sum + file.size, 0);

  return (
    <div
      className={cn(
        "relative mt-12 overflow-hidden rounded-[2rem] bg-ink text-white transition-[transform,box-shadow] duration-300 ease-out sm:mt-16",
        dragging
          ? "scale-[1.012] shadow-[0_0_0_6px_rgba(15,118,110,0.35),0_40px_80px_-30px_rgba(0,0,0,0.6)]"
          : "shadow-[0_40px_80px_-40px_rgba(0,0,0,0.55)]",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        aria-label="Choose files to work on"
        onChange={(event) => {
          if (event.target.files?.length) setFiles(Array.from(event.target.files));
          event.target.value = "";
        }}
      />
      <div className="grid lg:min-h-[26rem] lg:grid-cols-[1fr_1.1fr]">
        <div className="flex flex-col justify-between gap-10 p-8 sm:p-12">
          {files.length === 0 ? (
            <>
              <div>
                <p
                  className={cn(
                            "font-display text-4xl leading-[1] font-semibold tracking-[-0.03em] sm:text-5xl",
                  )}
                >
                  {dragging ? "Let go." : "Drop a file anywhere."}
                </p>
                <p className="mt-4 max-w-sm text-white/60">
                  PDF, JPG, PNG, HEIC, Word, Excel or PowerPoint. We show the
                  tools that fit, and nothing is read until you pick one.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="pressable inline-flex h-13 items-center gap-2 rounded-full bg-white px-7 text-base font-semibold text-ink hover:bg-white/90"
                >
                  <Upload className="size-5" aria-hidden />
                  Choose files
                </button>
                <span className="flex items-center gap-2 text-sm text-white/55">
                  <span className="size-1.5 rounded-full bg-[#34d399]" aria-hidden />
                  0 bytes sent so far
                </span>
              </div>
            </>
          ) : (
            <div>
              <div className="flex items-baseline justify-between gap-4">
                <p className="truncate text-sm text-white/60">
                  {files.length === 1 ? files[0].name : `${files.length} files`} ·{" "}
                  {formatBytes(total)}
                </p>
                <button
                  type="button"
                  onClick={() => setFiles([])}
                  className="shrink-0 text-sm font-medium text-white/80 underline-offset-4 hover:underline"
                >
                  Start over
                </button>
              </div>
              <p
                className={cn(
                        "font-display mt-4 text-4xl leading-[1] font-semibold tracking-[-0.03em]",
                )}
              >
                {matches.length > 0 ? "What should it become?" : "Nothing opens this yet."}
              </p>
              <ul className="mt-6 grid gap-2 sm:grid-cols-2">
                {matches.map((tool, index) => (
                  <li
                    key={tool.id}
                    className="enter"
                    style={{ "--i": index } as React.CSSProperties}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setHandoff({ files, from: "home" });
                        router.push(`/tools/${tool.slug}`);
                      }}
                      className="pressable group flex w-full items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-2.5 text-left ring-1 ring-white/10 hover:bg-white/[0.12]"
                    >
                      <ToolIcon id={tool.id} className="size-8" />
                      <span className="flex-1 text-sm font-semibold">{tool.shortTitle}</span>
                      <ArrowRight className="size-4 text-white/40 transition-transform duration-200 ease-out group-hover:translate-x-0.5" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="relative hidden border-l border-white/10 lg:block">
          <DemoLoop />
        </div>
      </div>
    </div>
  );
}

const SCENES = ["compress", "convert", "merge"] as const;

/** Plays the three most common jobs on a loop, so the stage shows the product. */
function DemoLoop() {
  const [scene, setScene] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setScene((s) => (s + 1) % SCENES.length), 3600);
    return () => window.clearInterval(timer);
  }, []);
  const name = SCENES[scene];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-[radial-gradient(60%_60%_at_50%_45%,rgba(255,255,255,0.07),transparent)]">
      <div key={name} className="scene flex h-56 items-center justify-center">
        {name === "compress" && (
          <div className="flex items-center gap-8">
            <Page label="report.pdf" tint="#e5322d" />
            <ArrowRight className="size-6 text-white/30" aria-hidden />
            <div className="squash">
              <Page label="report.pdf" tint="#e5322d" />
            </div>
          </div>
        )}
        {name === "convert" && (
          <div className="flex items-center gap-8">
            <Page label="IMG_2041.heic" tint="#8b45d9" photo />
            <ArrowRight className="size-6 text-white/30" aria-hidden />
            <div className="pop">
              <Page label="IMG_2041.jpg" tint="#f2a516" photo />
            </div>
          </div>
        )}
        {name === "merge" && (
          <div className="relative h-44 w-36">
            {[0, 1, 2].map((i) => (
              <div key={i} className="fan absolute inset-0" style={{ "--n": i - 1 } as React.CSSProperties}>
                <Page label={`part-${i + 1}.pdf`} tint="#ee6b2f" />
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="scene text-sm font-medium text-white/70" key={`${name}-caption`}>
        {name === "compress" && "Compress PDF · 4.2 MB → 1.1 MB"}
        {name === "convert" && "HEIC to JPG · opens on any phone"}
        {name === "merge" && "Merge PDF · three files become one"}
      </p>
      <div className="flex gap-1.5" aria-hidden>
        {SCENES.map((s, i) => (
          <span
            key={s}
            className={cn(
              "h-1 rounded-full transition-all duration-300 ease-out",
              i === scene ? "w-6 bg-white/80" : "w-1.5 bg-white/25",
            )}
          />
        ))}
      </div>
      <style>{`
        .scene { animation: scene-in 420ms cubic-bezier(0.23,1,0.32,1) both; }
        .squash { animation: squash 900ms 500ms cubic-bezier(0.23,1,0.32,1) both; transform-origin: bottom center; }
        .pop { animation: pop 600ms 500ms cubic-bezier(0.34,1.56,0.64,1) both; }
        .fan { animation: fan 1200ms 300ms cubic-bezier(0.77,0,0.175,1) both; }
        @keyframes scene-in { from { opacity: 0; transform: translateY(10px); } }
        @keyframes squash { from { transform: scale(1); } to { transform: scale(0.62); } }
        @keyframes pop { from { opacity: 0; transform: scale(0.8) rotate(-4deg); } }
        @keyframes fan {
          from { transform: translateX(calc(var(--n) * 120%)) rotate(calc(var(--n) * 6deg)); }
          to { transform: translate(calc(var(--n) * 6px), calc(var(--n) * -6px)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .scene, .squash, .pop, .fan { animation: none; }
        }
      `}</style>
    </div>
  );
}

function Page({ label, tint, photo = false }: { label: string; tint: string; photo?: boolean }) {
  return (
    <div className="flex h-44 w-36 flex-col overflow-hidden rounded-2xl bg-white p-3 text-ink shadow-[0_20px_40px_-20px_rgba(0,0,0,0.7)]">
      {photo ? (
        <div
          className="flex-1 rounded-lg"
          style={{ background: `linear-gradient(160deg, ${tint}, #111214 140%)` }}
        />
      ) : (
        <div className="flex-1 space-y-1.5 pt-1">
          <div className="h-2 w-2/3 rounded-full" style={{ backgroundColor: tint }} />
          {[90, 100, 80, 95, 70, 85].map((w, i) => (
            <div key={i} className="h-1.5 rounded-full bg-ink/10" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
      <p className="mt-2 truncate text-[11px] font-medium text-ink/60">{label}</p>
    </div>
  );
}

function BentoTile({
  tool,
  className,
  art,
  big = false,
  narrow = false,
}: {
  tool: ToolDefinition | undefined;
  className?: string;
  art: React.ReactNode;
  big?: boolean;
  narrow?: boolean;
}) {
  if (!tool) return null;
  return (
    <Link
      href={`/tools/${tool.slug}`}
      className={cn(
        "group pressable lift relative flex min-h-60 flex-col justify-between overflow-hidden rounded-[1.75rem] bg-white p-6 ring-1 ring-ink/6 hover:shadow-[0_24px_50px_-28px_rgba(17,18,20,0.35)] sm:p-7",
        className,
      )}
    >
      <div className="pointer-events-none absolute inset-0 flex items-center justify-end pr-6 opacity-90">
        {art}
      </div>
      <ToolIcon id={tool.id} className="relative size-10" />
      <div className={cn("relative", narrow ? "" : "sm:max-w-[55%]")}>
        <p
          className={cn(
            "font-display font-semibold tracking-[-0.02em]",
            big ? "text-4xl sm:text-5xl" : "text-2xl",
          )}
        >
          {tool.title}
        </p>
        <p className={cn("mt-2 text-sm leading-relaxed text-ink/60", big ? "max-w-xs" : "line-clamp-2")}>
          {tool.description}
        </p>
      </div>
    </Link>
  );
}

/* Tile art: simple shapes in currentColor-free fills that move on hover. */

function CompressArt() {
  return (
    <div className="relative mr-4 hidden h-64 w-52 sm:block">
      <div className="absolute inset-0 rounded-3xl bg-[#18975a]/10 transition-transform duration-500 ease-out group-hover:scale-[0.82]" />
      <div className="absolute inset-6 rounded-2xl bg-white shadow-[0_16px_32px_-18px_rgba(0,0,0,0.4)] transition-transform duration-500 ease-out group-hover:scale-[0.78]">
        <div className="space-y-2 p-4">
          <div className="h-2.5 w-1/2 rounded-full bg-[#18975a]" />
          {[95, 80, 100, 70, 90, 60, 85].map((w, i) => (
            <div key={i} className="h-2 rounded-full bg-ink/8" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
      <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white tabular-nums">
        <span className="group-hover:hidden">4.2 MB</span>
        <span className="hidden group-hover:inline">1.1 MB</span>
      </span>
    </div>
  );
}

function MergeArt() {
  return (
    <div className="relative mr-6 hidden h-36 w-40 sm:block">
      {[-1, 0, 1].map((n) => (
        <div
          key={n}
          className="absolute inset-y-0 left-1/2 w-24 -translate-x-1/2 rounded-xl bg-white shadow-[0_12px_24px_-14px_rgba(0,0,0,0.45)] ring-1 ring-ink/6 transition-transform duration-500 ease-out group-hover:!translate-x-[-50%] group-hover:!rotate-0"
          style={{ transform: `translateX(calc(-50% + ${n * 44}px)) rotate(${n * 8}deg)` }}
        >
          <div className="m-3 h-2 w-1/2 rounded-full bg-[#ee6b2f]" />
        </div>
      ))}
    </div>
  );
}

function SignArt() {
  return (
    <svg viewBox="0 0 160 80" className="mr-2 hidden w-40 text-[#7c4ddb] sm:block" aria-hidden>
      <path
        d="M8 55c14-22 24-38 30-30s-10 34 2 30 18-36 26-28-4 28 6 26 14-18 22-14 6 12 16 8 18-10 26-12"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        pathLength={1}
        className="[stroke-dasharray:1] group-hover:animate-[draw_900ms_cubic-bezier(0.65,0,0.35,1)_both]"
      />
      <line x1="8" y1="70" x2="152" y2="70" stroke="currentColor" strokeOpacity="0.25" strokeWidth="1.5" />
    </svg>
  );
}
