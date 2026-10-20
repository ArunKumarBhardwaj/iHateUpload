"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { FileWarning, Loader2, PenLine, Type } from "lucide-react";

import { loadPdfJs } from "@/lib/pdfjs";
import {
  formatDate,
  isEmptyValue,
  missingRequired,
  parseDate,
  type FieldValue,
  type FormField,
  type FormInfo,
  type FormWidget,
} from "@/lib/fill-form";
import type { ToolOptions } from "@/lib/tool-options";
import { cn } from "@/lib/utils";

type FillOptions = Extract<ToolOptions, { kind: "fill-form" }>;

type PageView = {
  /** Points at scale 1, after /Rotate. */
  width: number;
  height: number;
  /** Viewport transform at scale 1, to place widget rects. */
  transform: number[];
  url?: string;
};

const RENDER_SCALE = 1.6;

/** pdf.js viewport.convertToViewportRectangle, done by hand so it works on the cached transform. */
function toBox(rect: FormWidget["rect"], view: PageView) {
  const [a, b, c, d, e, f] = view.transform;
  const apply = (x: number, y: number) => [a * x + c * y + e, b * x + d * y + f];
  const [x1, y1] = apply(rect[0], rect[1]);
  const [x2, y2] = apply(rect[2], rect[3]);
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  return {
    left: (left / view.width) * 100,
    top: (top / view.height) * 100,
    width: (Math.abs(x2 - x1) / view.width) * 100,
    height: (Math.abs(y2 - y1) / view.height) * 100,
    /** Box height in points, for sizing text. */
    pts: Math.abs(y2 - y1),
    ptsWide: Math.abs(x2 - x1),
  };
}

/** Container-query units keep the type the same size as the PDF at any zoom. */
function cq(points: number, view: PageView) {
  return `${(points / view.width) * 100}cqw`;
}

function fontPoints(field: FormField, boxPts: number) {
  // Never taller than the box: some forms store a size that only fits after auto-shrink.
  const fit = field.multiline ? Math.min(12, boxPts * 0.8) : boxPts * 0.72;
  if (field.fontSize > 0) return Math.max(5, Math.min(field.fontSize, fit));
  if (field.multiline) return 10;
  return Math.max(6, Math.min(12, boxPts * 0.62));
}

export function FillFormCanvas({
  file,
  options,
  onOptions,
  disabled,
}: {
  file: File;
  options: FillOptions;
  onOptions: (next: FillOptions) => void;
  disabled: boolean;
}) {
  const [info, setInfo] = useState<FormInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<PageView[]>([]);
  const [seenFile, setSeenFile] = useState(file);

  if (seenFile !== file) {
    setSeenFile(file);
    setInfo(null);
    setError(null);
    setPages([]);
  }

  // Read the fields, then tell the sidebar how many there are and which required ones are empty.
  const report = (next: FillOptions) => onOptions(next);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { readForm } = await import("@/lib/fill-form");
        const read = await readForm(new Uint8Array(await file.arrayBuffer()));
        if (cancelled) return;
        setInfo(read);
        report({
          ...options,
          values: {},
          fieldCount: read.fields.filter((f) => f.type !== "signature").length,
          missing: missingRequired(read.fields, {}).map((f) => f.label),
        });
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "This PDF could not be read.");
        report({ ...options, values: {}, fieldCount: 0, missing: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only a new file starts a new read; option edits must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Render pages one after another, without the form widgets (our controls sit there instead).
  useEffect(() => {
    if (!info || info.fields.length === 0) return;
    let cancelled = false;
    const urls: string[] = [];
    void (async () => {
      const pdfjs = await loadPdfJs();
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
      try {
        const views: PageView[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: 1 });
          views.push({ width: vp.width, height: vp.height, transform: vp.transform });
        }
        if (cancelled) return;
        setPages(views.map((v) => ({ ...v })));
        for (let n = 1; n <= doc.numPages && !cancelled; n++) {
          const page = await doc.getPage(n);
          const viewport = page.getViewport({ scale: RENDER_SCALE });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width));
          canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            annotationMode: pdfjs.AnnotationMode.ENABLE_FORMS,
          }).promise;
          page.cleanup();
          const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
          canvas.width = 0;
          canvas.height = 0;
          if (!blob || cancelled) continue;
          const url = URL.createObjectURL(blob);
          urls.push(url);
          setPages((prev) => prev.map((p, i) => (i === n - 1 ? { ...p, url } : p)));
        }
      } finally {
        await doc.loadingTask.destroy();
      }
    })();
    return () => {
      cancelled = true;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [file, info]);

  const fields = useMemo(() => info?.fields ?? [], [info]);
  const valueOf = (field: FormField): FieldValue => options.values[field.name] ?? field.value;
  const setValue = (field: FormField, value: FieldValue) => {
    const values = { ...options.values, [field.name]: value };
    onOptions({ ...options, values, missing: missingRequired(fields, values).map((f) => f.label) });
  };

  if (error) {
    return (
      <Notice icon={<FileWarning className="size-5" />} title="This PDF could not be read">
        <p>{error}</p>
      </Notice>
    );
  }
  if (!info) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-secondary px-4 py-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-signal" /> Looking for form fields…
      </div>
    );
  }
  if (info.encrypted) {
    return (
      <Notice icon={<FileWarning className="size-5" />} title="This PDF is password-protected">
        <p>
          Remove the password with <Link className="font-medium text-signal underline" href="/tools/unlock-pdf">Unlock PDF</Link>, then come back to fill it.
        </p>
      </Notice>
    );
  }
  if (info.fields.length === 0) {
    return (
      <Notice icon={<FileWarning className="size-5" />} title="This PDF has no fillable fields">
        <p>
          {info.hasXfa
            ? "It is an XFA form, which only Adobe Acrobat can fill. "
            : "There are no boxes to type into, so there is nothing to fill. "}
          You can still put text or a signature anywhere on the page:
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/tools/edit-pdf" className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm font-medium text-ink hover:border-signal/40">
            <Type className="size-4 text-signal" /> Add text with Edit PDF
          </Link>
          <Link href="/tools/sign-pdf" className="inline-flex items-center gap-1.5 rounded-lg border border-ink/15 bg-card px-3 py-2 text-sm font-medium text-ink hover:border-signal/40">
            <PenLine className="size-4 text-signal" /> Sign with Sign PDF
          </Link>
        </div>
      </Notice>
    );
  }

  return (
    <div className="space-y-4" data-testid="fill-form-pages">
      {pages.map((view, pageIndex) => {
        const here = fields.flatMap((field) =>
          field.widgets
            .map((widget, w) => ({ field, widget, w }))
            .filter(({ widget }) => widget.pageIndex === pageIndex),
        );
        return (
          <div
            key={pageIndex}
            className="relative mx-auto w-full max-w-3xl overflow-hidden rounded-lg border border-ink/10 bg-white shadow-sm [container-type:inline-size]"
            style={{ aspectRatio: `${view.width} / ${view.height}` }}
            aria-label={`Page ${pageIndex + 1}`}
            role="group"
          >
            {view.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- a local blob of the rendered page
              <img src={view.url} alt="" className="absolute inset-0 size-full select-none" draggable={false} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
                <Loader2 className="mr-2 size-4 animate-spin" /> Drawing page {pageIndex + 1}…
              </div>
            )}
            {here.map(({ field, widget, w }) => (
              <FieldControl
                key={`${field.name}#${w}`}
                field={field}
                widget={widget}
                view={view}
                value={valueOf(field)}
                onValue={(value) => setValue(field, value)}
                disabled={disabled}
                first={w === field.widgets.findIndex((x) => x.pageIndex === widget.pageIndex)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div role="status" className="rounded-xl border border-ink/10 bg-secondary px-5 py-5 text-sm text-muted-foreground">
      <p className="mb-2 inline-flex items-center gap-2 text-base font-semibold text-ink">
        <span className="text-signal">{icon}</span>
        {title}
      </p>
      {children}
    </div>
  );
}

function FieldControl({
  field,
  widget,
  view,
  value,
  onValue,
  disabled,
  first,
}: {
  field: FormField;
  widget: FormWidget;
  view: PageView;
  value: FieldValue;
  onValue: (value: FieldValue) => void;
  disabled: boolean;
  /** Only the first copy of a repeated field is in the tab order and named for screen readers. */
  first: boolean;
}) {
  const box = toBox(widget.rect, view);
  const locked = disabled || field.readOnly;
  const empty = field.required && !field.readOnly && isEmptyValue(field, value);
  const pts = fontPoints(field, box.pts);
  const style: React.CSSProperties = {
    left: `${box.left}%`,
    top: `${box.top}%`,
    width: `${box.width}%`,
    height: `${box.height}%`,
    fontSize: cq(pts, view),
    textAlign: field.align,
  };
  const label = field.required ? `${field.label} (required)` : field.label;
  const common = {
    "aria-label": label,
    title: field.label + (field.readOnly ? " — read-only" : ""),
    "data-field": field.name,
    tabIndex: first ? undefined : -1,
    disabled: locked,
    "aria-required": field.required || undefined,
    "aria-invalid": empty || undefined,
  };
  const shell = cn(
    // Opaque, so any appearance pdf.js still paints (read-only fields) never shows through twice.
    "absolute m-0 rounded-[2px] border-0 bg-[#e8f2fd] p-0 text-ink outline-none transition-[box-shadow]",
    "focus:bg-[#f4f9ff] focus:ring-2 focus:ring-signal",
    field.readOnly && "cursor-not-allowed bg-[#f1f1f2] text-ink/70 disabled:opacity-100",
    empty && "ring-1 ring-destructive/70",
  );

  switch (field.type) {
    case "text": {
      const text = String(value ?? "");
      const pad = { paddingInline: cq(2, view) };
      if (field.dateFormat) {
        const iso = parseDate(text, field.dateFormat) ?? "";
        return (
          <input
            {...common}
            type="date"
            className={cn(shell, "font-sans")}
            style={{ ...style, ...pad }}
            value={iso}
            onChange={(e) => onValue(e.target.value ? formatDate(e.target.value, field.dateFormat!) : "")}
            data-date-format={field.dateFormat}
          />
        );
      }
      if (field.multiline) {
        return (
          <textarea
            {...common}
            className={cn(shell, "resize-none font-sans leading-tight")}
            style={{ ...style, ...pad, paddingBlock: cq(2, view) }}
            value={text}
            maxLength={field.maxLength}
            onChange={(e) => onValue(e.target.value)}
          />
        );
      }
      const comb = field.comb && field.maxLength ? field.maxLength : 0;
      return (
        <input
          {...common}
          type={field.password ? "password" : "text"}
          inputMode={field.numeric ? "decimal" : undefined}
          className={cn(shell, comb ? "font-mono" : "font-sans")}
          style={
            comb
              ? {
                  ...style,
                  textAlign: "left",
                  // One letter per cell: each cell is width/maxLength wide, monospace advance is 0.6em.
                  letterSpacing: `calc(${cq(box.ptsWide / comb, view)} - 0.6em)`,
                  paddingLeft: `calc(${cq(box.ptsWide / comb / 2, view)} - 0.3em)`,
                }
              : { ...style, ...pad }
          }
          value={text}
          maxLength={field.maxLength}
          autoComplete="off"
          onChange={(e) => {
            const next = e.target.value;
            if (field.numeric && next !== "" && !/^[-+]?[\d.,\s]*$/.test(next)) return;
            onValue(next);
          }}
        />
      );
    }
    case "checkbox":
      return (
        <input
          {...common}
          type="checkbox"
          className={cn(shell, "cursor-pointer accent-ink")}
          style={style}
          checked={value === true}
          onChange={(e) => onValue(e.target.checked)}
        />
      );
    case "radio":
      return (
        <input
          {...common}
          // Every widget of the group is reachable by arrow keys, as in a normal radio group.
          tabIndex={undefined}
          aria-label={`${label}: ${widget.onValue}`}
          type="radio"
          name={`fill:${field.name}`}
          className={cn(shell, "cursor-pointer rounded-full accent-ink")}
          style={style}
          value={widget.onValue}
          checked={value === widget.onValue}
          onChange={() => onValue(widget.onValue ?? "")}
          onClick={(e) => {
            // A second click on the picked button clears the group, as Acrobat allows.
            if (value === widget.onValue && e.detail > 0) onValue("");
          }}
        />
      );
    case "dropdown": {
      const choice = String(value ?? "");
      if (field.editable) {
        const listId = `fill-list-${field.name}`;
        return (
          <>
            <input
              {...common}
              className={cn(shell, "font-sans")}
              style={{ ...style, paddingInline: cq(2, view) }}
              value={choice}
              list={listId}
              onChange={(e) => onValue(e.target.value)}
            />
            <datalist id={listId}>
              {field.options.map((o) => <option key={o} value={o} />)}
            </datalist>
          </>
        );
      }
      return (
        <select
          {...common}
          className={cn(shell, "cursor-pointer font-sans")}
          style={style}
          value={choice}
          onChange={(e) => onValue(e.target.value)}
        >
          <option value="">{field.required ? "Choose…" : ""}</option>
          {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    case "listbox": {
      const picks = Array.isArray(value) ? value : value ? [String(value)] : [];
      return (
        <select
          {...common}
          multiple={field.multiSelect}
          size={Math.max(2, field.options.length)}
          className={cn(shell, "overflow-auto font-sans")}
          style={style}
          value={field.multiSelect ? picks : (picks[0] ?? "")}
          onChange={(e) => onValue(Array.from(e.target.selectedOptions, (o) => o.value))}
        >
          {field.options.map((o) => <option key={o} value={o} style={{ fontSize: "inherit" }}>{o}</option>)}
        </select>
      );
    }
    case "signature":
      return (
        <Link
          href="/tools/sign-pdf"
          className="absolute flex items-center justify-center rounded-[2px] border border-dashed border-signal/60 bg-signal/5 text-[10px] font-medium text-signal"
          style={style}
          title="Signature field — sign it with Sign PDF after saving"
          tabIndex={first ? undefined : -1}
        >
          Sign with Sign PDF
        </Link>
      );
  }
}
