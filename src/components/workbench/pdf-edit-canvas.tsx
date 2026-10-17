"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Bold,
  Highlighter,
  ImageIcon,
  Italic,
  MousePointer2,
  Redo2,
  AlignCenter,
  AlignLeft,
  AlignRight,
  Minus,
  Plus,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EditFindPanel } from "@/components/workbench/edit-find-panel";
import { PageStrip } from "@/components/workbench/page-strip";
import { loadPdfJs } from "@/lib/pdfjs";
import {
  fontFromName,
  hitTextRun,
  mergeTextRuns,
  ocrWordsToRuns,
  pdfJsItemsToRuns,
  textMarkBox,
  type PageTextRun,
  type PdfJsLikeItem,
} from "@/lib/pdf-edit-runs";
import { recognizePageWords } from "@/lib/edit-ocr";
import {
  EDIT_HIGHLIGHT,
  EDIT_INK,
  newHighlightMark,
  newImageMark,
  newRectMark,
  newTextMark,
  type EditAlign,
  type EditFontFamily,
  type EditMark,
  type EditMarkKind,
  type PageBox,
} from "@/lib/tool-options";
import { cn } from "@/lib/utils";

type Tool = "select" | EditMarkKind;
type DragKind = "move" | "se";
type DragState =
  | {
      kind: "draw";
      startX: number;
      startY: number;
      pageIndex: number;
    }
  | {
      kind: DragKind;
      startX: number;
      startY: number;
      id: string;
      origin: EditMark;
      snapshot: EditMark[];
    };

const DRAW_TOOLS: Tool[] = ["highlight", "rect"];

export function PdfEditCanvas({
  file,
  marks,
  onMarks,
  pageCount,
  disabled,
}: {
  file: File;
  marks: EditMark[];
  onMarks: (marks: EditMark[]) => void;
  pageCount: number;
  disabled: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const history = useRef<EditMark[][]>([]);
  const future = useRef<EditMark[][]>([]);
  const drag = useRef<DragState | null>(null);
  const draftRef = useRef<PageBox | null>(null);
  const moved = useRef(false);

  const [url, setUrl] = useState<string | null>(null);
  const [hostH, setHostH] = useState(480);
  const [tool, setTool] = useState<Tool>("select");
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PageBox | null>(null);
  const [runs, setRuns] = useState<PageTextRun[]>([]);
  const [hoverRun, setHoverRun] = useState<PageTextRun | null>(null);
  const [scan, setScan] = useState<"text" | "ocr" | "reading" | "empty">("empty");
  const [seenFile, setSeenFile] = useState(file);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [pageHeightPt, setPageHeightPt] = useState(792);

  if (file !== seenFile) {
    setSeenFile(file);
    setPageIndex(0);
    setSelectedId(null);
    setDraft(null);
    setRuns([]);
    setHoverRun(null);
    setScan("empty");
    setCanUndo(false);
    setCanRedo(false);
  }
  if (pageCount > 0 && pageIndex >= pageCount) {
    setPageIndex(pageCount - 1);
  }

  const selected = marks.find((mark) => mark.id === selectedId) ?? null;
  const visible = marks.filter((mark) => mark.pageIndex === pageIndex);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    void (async () => {
      const { getDocument } = await loadPdfJs();
      const data = new Uint8Array(await file.arrayBuffer());
      const doc = await getDocument({ data }).promise;
      try {
        const safeIndex = Math.min(pageIndex, Math.max(0, doc.numPages - 1));
        const page = await doc.getPage(safeIndex + 1);
        const viewport = page.getViewport({ scale: 1.35 });
        setPageHeightPt(viewport.height / 1.35);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvas, canvasContext: ctx, viewport }).promise;
        const content = await page.getTextContent();
        const rawItems = content.items as PdfJsLikeItem[];
        const nextRuns = mergeTextRuns(
          pdfJsItemsToRuns(
            rawItems,
            viewport.width,
            viewport.height,
            (x, y) => toViewportPoint(viewport, x, y),
            (fontName) => {
              if (!fontName) return undefined;
              let real: string | undefined;
              try {
                real = (page.commonObjs.get(fontName) as { name?: string } | undefined)?.name;
              } catch {
                real = undefined;
              }
              return fontFromName(real, content.styles[fontName]?.fontFamily);
            },
          ),
        );
        page.cleanup();
        const renderWidth = canvas.width;
        const renderHeight = canvas.height;
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", 0.9);
        });
        canvas.width = 0;
        canvas.height = 0;
        if (!blob || cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
        setHoverRun(null);
        if (nextRuns.length > 0) {
          setRuns(nextRuns);
          setScan("text");
          return;
        }
        setRuns([]);
        setScan("reading");
        try {
          const ocrRuns = mergeTextRuns(
            ocrWordsToRuns(
              await recognizePageWords(blob),
              renderWidth,
              renderHeight,
            ),
          );
          if (cancelled) return;
          setRuns(ocrRuns);
          setScan(ocrRuns.length > 0 ? "ocr" : "empty");
        } catch {
          if (cancelled) return;
          setRuns([]);
          setScan("empty");
        }
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

  useEffect(() => {
    if (!selectedId) return;
    const node = hostRef.current?.querySelector(
      `textarea[data-mark="${selectedId}"]`,
    );
    if (node instanceof HTMLTextAreaElement) node.focus();
  }, [selectedId]);

  // A new file starts with no drag in progress and nothing to undo.
  useEffect(() => {
    draftRef.current = null;
    history.current = [];
    future.current = [];
  }, [file]);

  const remember = (snapshot: EditMark[]) => {
    history.current.push(snapshot);
    if (history.current.length > 80) history.current.shift();
    future.current = [];
    setCanUndo(true);
    setCanRedo(false);
  };

  const commit = (next: EditMark[]) => {
    remember(marks);
    onMarks(next);
  };

  const patch = (id: string, partial: Partial<EditMark>) => {
    onMarks(
      marks.map((mark) =>
        mark.id === id ? ({ ...mark, ...partial } as EditMark) : mark,
      ),
    );
  };

  const undo = () => {
    const previous = history.current.pop();
    setCanUndo(history.current.length > 0);
    if (!previous) return;
    future.current.push(marks);
    setCanRedo(true);
    onMarks(previous);
    setSelectedId(null);
  };

  const redo = () => {
    const next = future.current.pop();
    setCanRedo(future.current.length > 0);
    if (!next) return;
    history.current.push(marks);
    setCanUndo(true);
    onMarks(next);
    setSelectedId(null);
  };

  const removeSelected = () => {
    if (!selectedId) return;
    commit(marks.filter((mark) => mark.id !== selectedId));
    setSelectedId(null);
  };

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (disabled) return;
    const typing =
      event.target instanceof HTMLElement &&
      (event.target.tagName === "TEXTAREA" ||
        event.target.tagName === "INPUT");
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      if (typing) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      if (typing) return;
      event.preventDefault();
      redo();
      return;
    }
    if (typing) return;
    if (event.key === "Escape") {
      setSelectedId(null);
      setTool("select");
    }
    if ((event.key === "Backspace" || event.key === "Delete") && selectedId) {
      event.preventDefault();
      removeSelected();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ratioOf = (event: React.PointerEvent<HTMLElement>) => {
    const host = hostRef.current;
    if (!host) return { x: 0, y: 0 };
    const rect = host.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
    };
  };

  const onHostPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || scan === "reading") return;
    if (tool === "image") {
      setSelectedId(null);
      return;
    }
    const start = ratioOf(event);
    if (tool === "select" || tool === "text") {
      const run = hitTextRun(runs, start.x, start.y);
      if (run) {
        event.preventDefault();
        const box = textMarkBox(run);
        const existing = marks.find(
          (mark) =>
            mark.kind === "text" &&
            mark.cover &&
            mark.pageIndex === pageIndex &&
            Math.abs(mark.x - box.x) < 0.01 &&
            Math.abs(mark.y - box.y) < 0.01,
        );
        if (existing) {
          setSelectedId(existing.id);
          setTool("select");
          return;
        }
        const mark = newTextMark(pageIndex, box.x, box.y, {
          w: box.w,
          h: box.h,
          text: run.text,
          fontSize: box.fontSize,
          cover: true,
        });
        if (run.font) Object.assign(mark, run.font);
        commit([...marks, mark]);
        setSelectedId(mark.id);
        setTool("select");
        setHoverRun(null);
        return;
      }
      event.preventDefault();
      const mark = newTextMark(
        pageIndex,
        clamp(start.x, 0, 0.72),
        clamp(start.y - 0.012, 0, 0.96),
        { w: 0.24, h: 0.028 },
      );
      commit([...marks, mark]);
      setSelectedId(mark.id);
      setTool("select");
      return;
    }
    if (!DRAW_TOOLS.includes(tool)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      kind: "draw",
      startX: start.x,
      startY: start.y,
      pageIndex,
    };
    setSelectedId(null);
    const next = { pageIndex, x: start.x, y: start.y, w: 0, h: 0 };
    draftRef.current = next;
    setDraft(next);
  };

  const onMarkPointerDown = (
    event: React.PointerEvent<HTMLElement>,
    mark: EditMark,
    kind: DragKind,
  ) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(mark.id);
    setTool("select");
    if (mark.kind === "text" && mark.cover && kind === "move") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    moved.current = false;
    drag.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      id: mark.id,
      origin: mark,
      snapshot: marks,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!drag.current && (tool === "select" || tool === "text")) {
      const pos = ratioOf(event);
      setHoverRun(hitTextRun(runs, pos.x, pos.y));
    }
    const active = drag.current;
    const host = hostRef.current;
    if (!active || !host) return;
    if (active.kind === "draw") {
      const now = ratioOf(event);
      const next = normalizeDraft(
        active.startX,
        active.startY,
        now.x,
        now.y,
        active.pageIndex,
      );
      draftRef.current = next;
      setDraft(next);
      return;
    }
    const rect = host.getBoundingClientRect();
    const dx = (event.clientX - active.startX) / rect.width;
    const dy = (event.clientY - active.startY) / rect.height;
    if (Math.abs(dx) + Math.abs(dy) > 0.004 && !moved.current) {
      moved.current = true;
      remember(active.snapshot);
    }
    if (!moved.current) return;
    if (active.kind === "move") {
      patch(active.id, {
        x: clamp(active.origin.x + dx, 0, 1 - active.origin.w),
        y: clamp(active.origin.y + dy, 0, 1 - active.origin.h),
      });
      return;
    }
    patch(active.id, {
      w: clamp(active.origin.w + dx, 0.06, 1 - active.origin.x),
      h: clamp(active.origin.h + dy, 0.04, 1 - active.origin.y),
    });
  };

  const endDrag = () => {
    const active = drag.current;
    drag.current = null;
    if (active?.kind !== "draw") return;
    const next = draftRef.current;
    draftRef.current = null;
    setDraft(null);
    if (!next || next.w <= 0.04 || next.h <= 0.04) return;
    const mark =
      tool === "rect" ? newRectMark(next) : newHighlightMark(next);
    commit([...marks, mark]);
    setSelectedId(mark.id);
    setTool("select");
  };

  const addImage = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    const dataUrl = await imageFileToDataUrl(file);
    const mark = newImageMark(pageIndex, dataUrl);
    commit([...marks, mark]);
    setSelectedId(mark.id);
    setTool("select");
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <ToolButton
          label="Select"
          pressed={tool === "select"}
          disabled={disabled}
          onClick={() => setTool("select")}
        >
          <MousePointer2 />
        </ToolButton>
        <ToolButton
          label="Text"
          pressed={tool === "text"}
          disabled={disabled}
          onClick={() => setTool("text")}
        >
          <Type />
        </ToolButton>
        <ToolButton
          label="Image"
          pressed={tool === "image"}
          disabled={disabled}
          onClick={() => imageInputRef.current?.click()}
        >
          <ImageIcon />
        </ToolButton>
        <ToolButton
          label="Highlight"
          pressed={tool === "highlight"}
          disabled={disabled}
          onClick={() => setTool("highlight")}
        >
          <Highlighter />
        </ToolButton>
        <ToolButton
          label="Box"
          pressed={tool === "rect"}
          disabled={disabled}
          onClick={() => setTool("rect")}
        >
          <Square />
        </ToolButton>
        <span className="mx-1 hidden h-6 w-px bg-ink/10 sm:block" />
        <ToolButton
          label="Undo"
          pressed={false}
          disabled={disabled || !canUndo}
          onClick={undo}
        >
          <Undo2 />
        </ToolButton>
        <ToolButton
          label="Redo"
          pressed={false}
          disabled={disabled || !canRedo}
          onClick={redo}
        >
          <Redo2 />
        </ToolButton>
        <ToolButton
          label="Delete"
          pressed={false}
          disabled={disabled || !selectedId}
          onClick={removeSelected}
        >
          <Trash2 />
        </ToolButton>
        <input
          ref={imageInputRef}
          type="file"
          aria-label="Choose an image to add"
          accept="image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
          className="sr-only"
          onChange={(event) => {
            void addImage(event.target.files);
            event.target.value = "";
          }}
        />
        {pageCount > 1 ? (
          <label
            className="ml-auto flex items-center gap-2 text-sm font-medium text-ink"
            htmlFor="edit-page"
          >
            Page
            <Input
              id="edit-page"
              type="number"
              min={1}
              max={pageCount}
              value={pageIndex + 1}
              disabled={disabled}
              className="h-10 w-16 sm:h-8"
              onChange={(event) => {
                const page = Number(event.target.value);
                if (!Number.isInteger(page)) return;
                setPageIndex(Math.min(pageCount, Math.max(1, page)) - 1);
                setSelectedId(null);
              }}
            />
            <span className="font-normal text-muted-foreground">
              of {pageCount}
            </span>
          </label>
        ) : null}
      </div>

      {selected && !disabled ? (
        <MarkProps
          mark={selected}
          pageHeightPt={pageHeightPt}
          onPatch={(partial) => patch(selected.id, partial)}
          onCommit={(partial) =>
            commit(
              marks.map((mark) =>
                mark.id === selected.id ? ({ ...mark, ...partial } as EditMark) : mark,
              ),
            )
          }
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          {tool === "highlight"
            ? "Drag on the page to highlight."
            : tool === "rect"
              ? "Drag on the page to draw a box."
              : scan === "reading"
                ? "Reading the words on this scan…"
                : scan === "ocr"
                  ? "Click a line to change it. These words came from OCR. Save covers them."
                  : scan === "text"
                    ? "Click a line to change it. Click empty space to add text."
                    : "No words found. Click the page to type on it."}
        </p>
      )}

      <EditFindPanel
        file={file}
        pageCount={pageCount}
        marks={marks}
        disabled={disabled}
        onApply={(next) => {
          commit(next);
          setSelectedId(null);
        }}
        onJump={(index) => {
          setPageIndex(index);
          setSelectedId(null);
        }}
      />
      <div className="flex flex-col gap-3 lg:flex-row">
      <PageStrip
        file={file}
        pageCount={pageCount}
        current={pageIndex}
        badges={pageBadges(marks)}
        disabled={disabled}
        onSelect={(index) => {
          setPageIndex(index);
          setSelectedId(null);
        }}
      />
      <div
        ref={hostRef}
        className={cn(
          "relative min-w-0 flex-1 overflow-hidden rounded-xl border border-ink/10 bg-muted/40 shadow-[0_12px_28px_-22px_rgba(20,22,28,0.45)]",
          disabled
            ? "cursor-default"
            : DRAW_TOOLS.includes(tool)
              ? "cursor-crosshair"
              : "cursor-text",
        )}
        onPointerDown={onHostPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHoverRun(null)}
      >
        {url ? (
          // Marks are the controls. The page image is the map.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt="" className="block w-full select-none" />
        ) : (
          <div className="flex aspect-[3/4] items-center justify-center text-sm text-muted-foreground">
            Reading the page…
          </div>
        )}
        {hoverRun && !disabled && (tool === "select" || tool === "text") ? (
          <div
            className="pointer-events-none absolute bg-sky-400/15 ring-1 ring-sky-500/60"
            style={{
              left: `${hoverRun.x * 100}%`,
              top: `${hoverRun.y * 100}%`,
              width: `${hoverRun.w * 100}%`,
              height: `${hoverRun.h * 100}%`,
              zIndex: 5,
            }}
          />
        ) : null}
        {visible.map((mark) => (
          <MarkLayer
            key={mark.id}
            mark={mark}
            selected={selectedId === mark.id}
            disabled={disabled}
            hostH={hostH}
            onPointerDown={onMarkPointerDown}
            onText={(text) => patch(mark.id, { text })}
          />
        ))}
        {draft && draft.w > 0 && draft.h > 0 ? (
          <div
            className={cn(
              "pointer-events-none absolute border-2 border-dashed border-signal",
              tool === "highlight" ? "bg-yellow-300/40" : "bg-transparent",
            )}
            style={{
              left: `${draft.x * 100}%`,
              top: `${draft.y * 100}%`,
              width: `${draft.w * 100}%`,
              height: `${draft.h * 100}%`,
            }}
          />
        ) : null}
      </div>
      </div>
    </div>
  );
}

function pageBadges(marks: EditMark[]) {
  const out: Record<number, number> = {};
  for (const mark of marks) out[mark.pageIndex] = (out[mark.pageIndex] ?? 0) + 1;
  return out;
}

function MarkLayer({
  mark,
  selected,
  disabled,
  hostH,
  onPointerDown,
  onText,
}: {
  mark: EditMark;
  selected: boolean;
  disabled: boolean;
  hostH: number;
  onPointerDown: (
    event: React.PointerEvent<HTMLElement>,
    mark: EditMark,
    kind: DragKind,
  ) => void;
  onText: (text: string) => void;
}) {
  const z =
    mark.kind === "highlight"
      ? 1
      : mark.kind === "rect"
        ? 2
        : mark.kind === "image"
          ? 3
          : 4;
  return (
    <div
      role="button"
      aria-label={
        mark.kind === "text"
          ? "Text"
          : mark.kind === "image"
            ? "Image"
            : mark.kind === "highlight"
              ? "Highlight"
              : "Box"
      }
      aria-pressed={selected}
      className={cn(
        "absolute",
        selected ? "ring-1 ring-signal" : mark.kind === "text" ? "ring-0" : "ring-1 ring-ink/20",
        disabled || (mark.kind === "text" && mark.cover)
          ? "cursor-text"
          : "cursor-move",
      )}
      style={{
        left: `${mark.x * 100}%`,
        top: `${mark.y * 100}%`,
        width: `${mark.w * 100}%`,
        height: `${mark.h * 100}%`,
        zIndex: z,
      }}
      onPointerDown={(event) => onPointerDown(event, mark, "move")}
    >
      {mark.kind === "highlight" ? (
        <div
          className="h-full w-full"
          style={{ background: mark.color, opacity: 0.42 }}
        />
      ) : null}
      {mark.kind === "rect" ? (
        <div
          className="h-full w-full"
          style={{
            border: `2px solid ${mark.color}`,
            background: mark.fill ? mark.color : "transparent",
            opacity: mark.fill ? 0.28 : 1,
          }}
        />
      ) : null}
      {mark.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={mark.dataUrl}
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
        />
      ) : null}
      {mark.kind === "text" ? (
        <textarea
          data-mark={mark.id}
          value={mark.text}
          disabled={disabled}
          aria-label="Text on the page"
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => onText(event.target.value)}
          className={cn(
            "h-full w-full resize-none overflow-hidden px-0.5 py-0 leading-none outline-none",
            mark.cover ? "bg-white" : "bg-transparent",
          )}
          style={{
            fontSize: Math.max(10, mark.fontSize * hostH),
            color: mark.color,
            fontFamily:
              mark.family === "times"
                ? 'Times, "Times New Roman", serif'
                : mark.family === "courier"
                  ? '"Courier New", Courier, monospace'
                  : "Helvetica, Arial, sans-serif",
            fontWeight: mark.bold ? 700 : 400,
            fontStyle: mark.italic ? "italic" : "normal",
            textAlign: mark.align ?? "left",
          }}
        />
      ) : null}
      {selected && !disabled && !(mark.kind === "text" && mark.cover) ? (
        <button
          type="button"
          aria-label="Resize"
          className="absolute -right-1.5 -bottom-1.5 size-3 rounded-full border border-signal bg-card"
          onPointerDown={(event) => onPointerDown(event, mark, "se")}
        />
      ) : null}
    </div>
  );
}

function MarkProps({
  mark,
  pageHeightPt,
  onPatch,
  onCommit,
}: {
  mark: EditMark;
  pageHeightPt: number;
  onPatch: (partial: Partial<EditMark>) => void;
  onCommit: (partial: Partial<EditMark>) => void;
}) {
  if (mark.kind === "image") {
    return <p className="text-sm text-muted-foreground">Drag to move. Corner to resize.</p>;
  }
  const colors = mark.kind === "highlight" ? EDIT_HIGHLIGHT : EDIT_INK;
  const pt = mark.kind === "text" ? Math.round(mark.fontSize * pageHeightPt * 2) / 2 : 0;
  const setPt = (next: number) => {
    const clamped = Math.min(144, Math.max(4, next));
    onCommit({ fontSize: clamped / pageHeightPt });
  };
  const toggle = "size-10 sm:size-8";
  return (
    <div className="flex flex-wrap items-center gap-3">
      {mark.kind === "text" ? (
        <>
          <select
            aria-label="Font"
            value={mark.family ?? "helvetica"}
            className="h-10 rounded-lg border border-ink/15 bg-card px-2 text-sm text-ink sm:h-8"
            onChange={(event) => onCommit({ family: event.target.value as EditFontFamily })}
          >
            <option value="helvetica">Helvetica</option>
            <option value="times">Times</option>
            <option value="courier">Courier</option>
          </select>
          <div className="flex items-center gap-1" role="group" aria-label="Size">
            <button
              type="button"
              aria-label="Smaller"
              className={cn(toggle, "flex items-center justify-center rounded-lg border border-ink/15 bg-card")}
              onClick={() => setPt(pt - 1)}
            >
              <Minus className="size-4" />
            </button>
            <input
              aria-label="Font size in points"
              type="number"
              min={4}
              max={144}
              step={0.5}
              value={pt}
              className="h-10 w-14 rounded-lg border border-ink/15 bg-card text-center text-sm sm:h-8"
              onChange={(event) => {
                const next = Number(event.target.value);
                if (Number.isFinite(next) && next > 0) setPt(next);
              }}
            />
            <button
              type="button"
              aria-label="Larger"
              className={cn(toggle, "flex items-center justify-center rounded-lg border border-ink/15 bg-card")}
              onClick={() => setPt(pt + 1)}
            >
              <Plus className="size-4" />
            </button>
            <span className="text-xs text-muted-foreground">pt</span>
          </div>
          <div className="flex items-center gap-1">
            <SizeChip label={<Bold className="size-4" />} name="Bold" active={Boolean(mark.bold)} onClick={() => onCommit({ bold: !mark.bold })} />
            <SizeChip label={<Italic className="size-4" />} name="Italic" active={Boolean(mark.italic)} onClick={() => onCommit({ italic: !mark.italic })} />
          </div>
          <div className="flex items-center gap-1">
            {(
              [
                ["left", <AlignLeft key="l" className="size-4" />],
                ["center", <AlignCenter key="c" className="size-4" />],
                ["right", <AlignRight key="r" className="size-4" />],
              ] as Array<[EditAlign, React.ReactNode]>
            ).map(([id, icon]) => (
              <SizeChip
                key={id}
                label={icon}
                name={`Align ${id}`}
                active={(mark.align ?? "left") === id}
                onClick={() => onCommit({ align: id })}
              />
            ))}
          </div>
        </>
      ) : null}
      <div className="flex items-center gap-1.5">
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            className={cn(
              "size-7 rounded-full border sm:size-6",
              mark.color === color ? "border-ink ring-2 ring-ink/30" : "border-ink/20",
            )}
            style={{ background: color }}
            onClick={() => onPatch({ color })}
          />
        ))}
        <input
          type="color"
          aria-label="Custom colour"
          value={/^#[0-9a-f]{6}$/i.test(mark.color) ? mark.color : "#14161c"}
          className="size-7 cursor-pointer rounded-full border border-ink/20 bg-transparent p-0 sm:size-6"
          onChange={(event) => onPatch({ color: event.target.value })}
        />
      </div>
      {mark.kind === "rect" ? (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={mark.fill}
            onChange={(event) => onPatch({ fill: event.target.checked })}
          />
          Fill
        </label>
      ) : null}
    </div>
  );
}

function ToolButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={pressed ? "default" : "outline"}
      className="h-10 gap-1.5 px-3 sm:h-8"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

function SizeChip({
  label,
  name,
  active,
  onClick,
}: {
  label: React.ReactNode;
  name: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={name}
      aria-pressed={active}
      className={cn(
        "flex size-10 items-center justify-center rounded-lg border text-sm font-semibold sm:size-8",
        active ? "border-ink bg-ink text-card" : "border-ink/15 bg-card text-ink",
      )}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function normalizeDraft(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  pageIndex: number,
): PageBox {
  const x = clamp(Math.min(ax, bx), 0, 1);
  const y = clamp(Math.min(ay, by), 0, 1);
  const x2 = clamp(Math.max(ax, bx), 0, 1);
  const y2 = clamp(Math.max(ay, by), 0, 1);
  return { pageIndex, x, y, w: x2 - x, h: y2 - y };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toViewportPoint(
  viewport: {
    convertToViewportPoint?: (x: number, y: number) => number[];
    transform: number[];
  },
  x: number,
  y: number,
) {
  if (typeof viewport.convertToViewportPoint === "function") {
    const point = viewport.convertToViewportPoint(x, y);
    return { x: point[0], y: point[1] };
  }
  const t = viewport.transform;
  return {
    x: t[0] * x + t[2] * y + t[4],
    y: t[1] * x + t[3] * y + t[5],
  };
}

async function imageFileToDataUrl(file: File): Promise<string> {
  if (file.type === "image/png" || file.type === "image/jpeg") {
    return readDataUrl(file);
  }
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, bitmap.width);
  canvas.height = Math.max(1, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/png");
  canvas.width = 0;
  canvas.height = 0;
  return dataUrl;
}

function readDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}
