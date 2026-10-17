"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { CalendarDays, Copy, Redo2, Trash2, Undo2 } from "lucide-react";

import { PageStrip } from "@/components/workbench/page-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadPdfJs } from "@/lib/pdfjs";
import { inkBounds, removeBackground } from "@/lib/signature-ink";
import type { SignPlacement } from "@/lib/tool-options";
import { cn } from "@/lib/utils";

const INKS = ["#14161c", "#1d4ed8", "#d61f3a"] as const;
const SCRIPTS = [
  { id: "script", label: "Script", css: '"Snell Roundhand","Brush Script MT","Segoe Script",cursive', style: "italic" },
  { id: "serif", label: "Serif", css: "Georgia,serif", style: "italic" },
  { id: "plain", label: "Plain", css: "Helvetica,Arial,sans-serif", style: "normal" },
] as const;
const STORE_KEY = "ihu-sign-last";

type Mode = "draw" | "type" | "image";
type Sig = { dataUrl: string; aspect: number };
type Stroke = { pts: Array<[number, number]> };
type Drag = {
  kind: "move" | "se";
  startX: number;
  startY: number;
  id: string;
  origin: SignPlacement;
};

/** Survives switching tools for the length of the visit, never written anywhere. */
let sessionSignature: Sig | null = null;

function readSaved(): Sig | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Sig) : null;
  } catch {
    return null;
  }
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function cropToDataUrl(canvas: HTMLCanvasElement): Sig | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height);
  const b = inkBounds(data.data, width, height);
  if (!b) return null;
  const pad = 6;
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  const w = Math.min(width - x, b.w + pad * 2);
  const h = Math.min(height - y, b.h + pad * 2);
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  out.getContext("2d")?.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  const dataUrl = out.toDataURL("image/png");
  out.width = 0;
  out.height = 0;
  return { dataUrl, aspect: h / w };
}

export function SignCanvas({
  file,
  placements,
  onPlacements,
  pageCount,
  disabled,
}: {
  file: File;
  placements: SignPlacement[];
  onPlacements: (next: SignPlacement[]) => void;
  pageCount: number;
  disabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const past = useRef<SignPlacement[][]>([]);
  const future = useRef<SignPlacement[][]>([]);
  const drag = useRef<Drag | null>(null);
  const moved = useRef(false);

  const [url, setUrl] = useState<string | null>(null);
  const [pageAspect, setPageAspect] = useState(0.75);
  const [hostH, setHostH] = useState(600);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hist, setHist] = useState({ undo: 0, redo: 0 });
  const bump = () => setHist({ undo: past.current.length, redo: future.current.length });
  const [sig, setSig] = useState<Sig | null>(null);
  const [seenFile, setSeenFile] = useState(file);

  if (seenFile !== file) {
    setSeenFile(file);
    setPageIndex(0);
    setSelectedId(null);
    setHist({ undo: 0, redo: 0 });
  }

  useEffect(() => {
    past.current = [];
    future.current = [];
  }, [file]);

  const visible = placements.filter((p) => p.pageIndex === pageIndex);
  const selected = placements.find((p) => p.id === selectedId) ?? null;
  const badges: Record<number, number> = {};
  for (const p of placements) badges[p.pageIndex] = (badges[p.pageIndex] ?? 0) + 1;

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    void (async () => {
      const { getDocument } = await loadPdfJs();
      const doc = await getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      try {
        const page = await doc.getPage(Math.min(pageIndex, doc.numPages - 1) + 1);
        const viewport = page.getViewport({ scale: 1.35 });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        page.cleanup();
        const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
        const aspect = canvas.width / canvas.height;
        canvas.width = 0;
        canvas.height = 0;
        if (!blob || cancelled) return;
        revoked = URL.createObjectURL(blob);
        setPageAspect(aspect);
        setUrl(revoked);
      } finally {
        await doc.loadingTask.destroy();
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file, pageIndex]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const sync = () => setHostH(host.getBoundingClientRect().height);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(host);
    return () => observer.disconnect();
  }, [url]);

  const commit = (next: SignPlacement[]) => {
    past.current.push(placements);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    onPlacements(next);
    bump();
  };
  const undo = () => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(placements);
    onPlacements(prev);
    setSelectedId(null);
    bump();
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(placements);
    onPlacements(next);
    bump();
  };
  const remove = () => {
    if (!selectedId) return;
    commit(placements.filter((p) => p.id !== selectedId));
    setSelectedId(null);
  };
  const duplicate = () => {
    if (!selected) return;
    const copy = { ...selected, id: crypto.randomUUID(), x: clamp(selected.x + 0.03, 0, 1 - selected.w), y: clamp(selected.y + 0.03, 0, 1 - selected.h) };
    commit([...placements, copy]);
    setSelectedId(copy.id);
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (disabled) return;
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA");
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !typing) {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y" && !typing) {
      event.preventDefault();
      redo();
      return;
    }
    if (typing) return;
    if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
      event.preventDefault();
      remove();
    }
  });
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addSignature = (value: Sig) => {
    const w = 0.3;
    const h = clamp(w * value.aspect * pageAspect, 0.03, 0.4);
    const mark: SignPlacement = {
      id: crypto.randomUUID(),
      pageIndex,
      x: 0.5 - w / 2,
      y: 0.62,
      w,
      h,
      dataUrl: value.dataUrl,
    };
    commit([...placements, mark]);
    setSelectedId(mark.id);
  };

  const addDate = () => {
    const mark: SignPlacement = {
      id: crypto.randomUUID(),
      pageIndex,
      x: 0.6,
      y: 0.72,
      w: 0.22,
      h: 0.03,
      text: new Date().toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
      color: INKS[0],
    };
    commit([...placements, mark]);
    setSelectedId(mark.id);
  };

  const startDrag = (event: React.PointerEvent<HTMLElement>, p: SignPlacement, kind: Drag["kind"]) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(p.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    moved.current = false;
    drag.current = { kind, startX: event.clientX, startY: event.clientY, id: p.id, origin: p };
  };

  const onMove = (event: React.PointerEvent<HTMLElement>) => {
    const active = drag.current;
    const host = hostRef.current;
    if (!active || !host) return;
    const rect = host.getBoundingClientRect();
    const dx = (event.clientX - active.startX) / rect.width;
    const dy = (event.clientY - active.startY) / rect.height;
    if (!moved.current) {
      if (Math.abs(dx) + Math.abs(dy) < 0.004) return;
      moved.current = true;
      past.current.push(placements);
      future.current = [];
      bump();
    }
    const o = active.origin;
    const next =
      active.kind === "move"
        ? { x: clamp(o.x + dx, 0, 1 - o.w), y: clamp(o.y + dy, 0, 1 - o.h) }
        : (() => {
            const w = clamp(o.w + dx, 0.05, 1 - o.x);
            const h = o.dataUrl ? clamp((w / o.w) * o.h, 0.02, 1 - o.y) : clamp(o.h + dy, 0.02, 1 - o.y);
            return { w: o.dataUrl && h === 1 - o.y ? o.w : w, h };
          })();
    onPlacements(placements.map((p) => (p.id === active.id ? { ...p, ...next } : p)));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className="space-y-3">
      <SignatureMaker
        disabled={disabled}
        sig={sig}
        onSig={(next) => {
          setSig(next);
          sessionSignature = next;
        }}
        onAdd={addSignature}
        pageIndex={pageIndex}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5 sm:h-8" disabled={disabled} onClick={addDate}>
          <CalendarDays /> <span>Add date</span>
        </Button>
        <span className="mx-1 hidden h-6 w-px bg-ink/10 sm:block" />
        <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5 sm:h-8" aria-label="Undo" disabled={disabled || hist.undo === 0} onClick={undo}>
          <Undo2 /> <span className="hidden sm:inline">Undo</span>
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5 sm:h-8" aria-label="Redo" disabled={disabled || hist.redo === 0} onClick={redo}>
          <Redo2 /> <span className="hidden sm:inline">Redo</span>
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5 sm:h-8" aria-label="Duplicate" disabled={disabled || !selected} onClick={duplicate}>
          <Copy /> <span className="hidden sm:inline">Duplicate</span>
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-10 gap-1.5 sm:h-8" aria-label="Delete" disabled={disabled || !selected} onClick={remove}>
          <Trash2 /> <span className="hidden sm:inline">Delete</span>
        </Button>
        {pageCount > 1 ? (
          <span className="ml-auto text-sm text-muted-foreground">
            Page {pageIndex + 1} of {pageCount} · {placements.length} placed
          </span>
        ) : (
          <span className="ml-auto text-sm text-muted-foreground">{placements.length} placed</span>
        )}
      </div>
      {selected?.text !== undefined && selected ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Stamp text"
            value={selected.text}
            disabled={disabled}
            className="h-10 w-48 sm:h-8"
            onChange={(e) =>
              onPlacements(placements.map((p) => (p.id === selected.id ? { ...p, text: e.target.value } : p)))
            }
          />
          {INKS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              className={cn("size-7 rounded-full border sm:size-6", selected.color === c ? "border-ink ring-2 ring-ink/30" : "border-ink/20")}
              style={{ background: c }}
              onClick={() => commit(placements.map((p) => (p.id === selected.id ? { ...p, color: c } : p)))}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {placements.length === 0
            ? "Make a signature above, press Place on this page, then drag it where it goes. Use the page strip to sign other pages."
            : "Drag to move. Pull the corner to resize. Delete removes the selected one."}
        </p>
      )}
      <div className="flex flex-col gap-3 lg:flex-row">
        <PageStrip file={file} pageCount={pageCount} current={pageIndex} badges={badges} disabled={disabled} onSelect={(i) => { setPageIndex(i); setSelectedId(null); }} />
        <div
          ref={hostRef}
          className="relative min-w-0 flex-1 overflow-hidden rounded-xl border border-ink/10 bg-muted/40 shadow-[0_12px_28px_-22px_rgba(20,22,28,0.45)]"
          onPointerDown={() => setSelectedId(null)}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt="" className="block w-full select-none" draggable={false} />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center text-sm text-muted-foreground">Reading the page…</div>
          )}
          {visible.map((p) => (
            <div
              key={p.id}
              role="button"
              aria-label={p.text !== undefined ? "Date stamp" : "Signature"}
              aria-pressed={selectedId === p.id}
              className={cn("absolute cursor-move touch-none", selectedId === p.id ? "ring-2 ring-signal" : "ring-1 ring-ink/20 hover:ring-signal/60")}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.w * 100}%`, height: `${p.h * 100}%` }}
              onPointerDown={(e) => startDrag(e, p, "move")}
            >
              {p.dataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.dataUrl} alt="" className="h-full w-full object-fill" draggable={false} />
              ) : (
                <span
                  className="flex h-full w-full items-center overflow-hidden whitespace-nowrap leading-none"
                  style={{ color: p.color, fontFamily: "Helvetica,Arial,sans-serif", fontSize: Math.max(8, p.h * hostH * 0.8) }}
                >
                  {p.text}
                </span>
              )}
              {selectedId === p.id && !disabled ? (
                <button
                  type="button"
                  aria-label="Resize"
                  className="absolute -right-2 -bottom-2 size-4 touch-none rounded-full border-2 border-signal bg-card"
                  onPointerDown={(e) => startDrag(e, p, "se")}
                />
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SignatureMaker({
  disabled,
  sig,
  onSig,
  onAdd,
  pageIndex,
}: {
  disabled: boolean;
  sig: Sig | null;
  onSig: (sig: Sig | null) => void;
  onAdd: (sig: Sig) => void;
  pageIndex: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const photo = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);

  const [mode, setMode] = useState<Mode>("draw");
  const [color, setColor] = useState<string>(INKS[0]);
  const [width, setWidth] = useState(4);
  const [text, setText] = useState("");
  const [script, setScript] = useState<(typeof SCRIPTS)[number]["id"]>("script");
  const [threshold, setThreshold] = useState(170);
  const [recolor, setRecolor] = useState(true);
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState<Sig | null>(null);

  useEffect(() => {
    // Reading the opt-in copy has to wait for the browser.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaved(readSaved());
    if (sessionSignature) onSig(sessionSignature);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const paint = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mode === "draw") {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const s of strokes.current) {
        if (s.pts.length === 1) {
          ctx.beginPath();
          ctx.arc(s.pts[0][0], s.pts[0][1], width / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
      }
    } else if (mode === "type" && text.trim()) {
      const face = SCRIPTS.find((s) => s.id === script) ?? SCRIPTS[0];
      ctx.fillStyle = color;
      ctx.font = `${face.style} 96px ${face.css}`;
      ctx.textBaseline = "middle";
      ctx.fillText(text.trim(), 24, canvas.height / 2, canvas.width - 48);
    } else if (mode === "image" && photo.current) {
      const img = photo.current;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      removeBackground(data.data, { threshold, color: recolor ? color : undefined });
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(data, 0, 0);
    }
    onSig(cropToDataUrl(canvas));
  };

  // Redraw whenever a setting changes so colour and width apply to what is already there.
  useEffect(() => {
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, color, width, text, script, threshold, recolor]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * e.currentTarget.width,
      ((e.clientY - rect.top) / rect.height) * e.currentTarget.height,
    ];
  };

  const loadPhoto = (file: File | undefined) => {
    if (!file) return;
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(src);
      photo.current = img;
      paint();
    };
    img.src = src;
  };

  const place = (value: Sig) => {
    if (remember) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(value));
        setSaved(value);
      } catch {
        /* storage is optional */
      }
    }
    onAdd(value);
  };

  const modes: Array<{ id: Mode; title: string }> = [
    { id: "draw", title: "Draw" },
    { id: "type", title: "Type" },
    { id: "image", title: "Photo or image" },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-ink/10 bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {modes.map((m) => (
          <Button key={m.id} type="button" size="sm" variant={mode === m.id ? "default" : "outline"} disabled={disabled} onClick={() => setMode(m.id)}>
            {m.title}
          </Button>
        ))}
        <span className="mx-1 hidden h-6 w-px bg-ink/10 sm:block" />
        <div className="flex items-center gap-1.5" role="group" aria-label="Ink colour">
          {INKS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Ink ${c}`}
              disabled={disabled}
              className={cn("size-7 rounded-full border sm:size-6", color === c ? "border-ink ring-2 ring-ink/30" : "border-ink/20")}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
          <input
            type="color"
            aria-label="Custom ink colour"
            value={color}
            disabled={disabled}
            className="size-7 cursor-pointer rounded-full border border-ink/20 bg-transparent p-0 sm:size-6"
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        {mode === "draw" ? (
          <label className="flex items-center gap-2 text-sm text-ink">
            Stroke
            <input type="range" min={2} max={12} value={width} disabled={disabled} onChange={(e) => setWidth(Number(e.target.value))} />
            <span className="w-8 text-muted-foreground">{width}px</span>
          </label>
        ) : null}
      </div>

      {mode === "type" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Type your name" value={text} disabled={disabled} placeholder="Your name" className="h-10 w-56 sm:h-8" onChange={(e) => setText(e.target.value)} />
          {SCRIPTS.map((s) => (
            <Button key={s.id} type="button" size="sm" variant={script === s.id ? "default" : "outline"} disabled={disabled} onClick={() => setScript(s.id)}>
              {s.label}
            </Button>
          ))}
        </div>
      ) : null}
      {mode === "image" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Signature photo"
            type="file"
            accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
            disabled={disabled}
            className="w-64"
            onChange={(e) => {
              loadPhoto(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            Remove paper
            <input type="range" min={60} max={250} value={threshold} disabled={disabled} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={recolor} onChange={(e) => setRecolor(e.target.checked)} />
            Use ink colour
          </label>
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        width={720}
        height={200}
        aria-label="Signature pad"
        className={cn(
          "h-28 w-full touch-none rounded-lg border border-dashed border-ink/20 bg-[repeating-conic-gradient(#f1f2f4_0%_25%,#fff_0%_50%)] bg-[length:16px_16px]",
          mode === "draw" && "cursor-crosshair",
        )}
        onPointerDown={(e) => {
          if (disabled || mode !== "draw") return;
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          strokes.current.push({ pts: [point(e)] });
          paint();
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          strokes.current.at(-1)?.pts.push(point(e));
          paint();
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={disabled || !sig} onClick={() => sig && place(sig)}>
          Place on page {pageIndex + 1}
        </Button>
        {mode === "draw" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              strokes.current = [];
              paint();
            }}
          >
            Clear
          </Button>
        ) : null}
        {saved ? (
          <>
            <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onAdd(saved)}>
              Use saved signature
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                try {
                  window.localStorage.removeItem(STORE_KEY);
                } catch {
                  /* nothing stored */
                }
                setSaved(null);
              }}
            >
              Forget it
            </Button>
          </>
        ) : null}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember on this device only (never uploaded)
        </label>
      </div>
    </div>
  );
}
