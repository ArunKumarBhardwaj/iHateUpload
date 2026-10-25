"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check as CheckIcon,
  Download,
  ExternalLink,
  ImagePlus,
  Info,
  Loader2,
  RotateCcw,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EXAMS, getExam } from "@/lib/exam-photo/specs";
import { coverCrop } from "@/lib/exam-photo/fit";
import { takeHandoff } from "@/lib/handoff";
import {
  openImage,
  photoArea,
  renderSlot,
  usesFraming,
  type RenderResult,
} from "@/lib/exam-photo/render";
import type { CropFraming, ExamSpec, SlotSpec } from "@/lib/exam-photo/types";
import { cn } from "@/lib/utils";

const CENTER: CropFraming = { zoom: 1, x: 0.5, y: 0.5 };

function todayInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 2026-10-25 → 25/10/2026, the way notices print it. */
function printedDate(value: string): string {
  const [y, m, d] = value.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

function kbRange(slot: SlotSpec): string {
  return slot.minKb > 0 ? `${slot.minKb}–${slot.maxKb} KB` : `up to ${slot.maxKb} KB`;
}

export function ExamPhotoStudio({ initial }: { initial?: string }) {
  const [slug, setSlug] = useState(initial ?? EXAMS[0].slug);
  const exam = getExam(slug) ?? EXAMS[0];
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayInput);
  const [stamp, setStamp] = useState(false);
  const hasPhoto = exam.slots.some((s) => s.kind === "photo");
  const [shared, setShared] = useState<File | null>(null);
  // A shared image fills the photo slot; on a signature-only form the user decides, per exam.
  const [sharedFor, setSharedFor] = useState<string | null>(null);
  const sharedAsFirst = sharedFor === exam.slug;

  /**
   * A file shared into the app arrives as a one-shot handoff. It only exists
   * on the client, so it is read after mount rather than in a state initialiser.
   */
  useEffect(() => {
    const file = takeHandoff()?.files[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (file) setShared(file);
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Exam or form</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Exam or form">
          {EXAMS.map((e) => {
            const chip = cn(
              "pressable inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium",
              e.slug === exam.slug
                ? "border-ink bg-ink text-background"
                : "border-ink/15 bg-card text-ink hover:border-ink/35",
            );
            // On an exam's own page the heading and rule table belong to it, so other exams are links.
            return initial ? (
              <Link
                key={e.slug}
                href={`/exam-photo/${e.slug}`}
                aria-current={e.slug === exam.slug ? "page" : undefined}
                className={chip}
              >
                {e.name}
              </Link>
            ) : (
              <button
                key={e.slug}
                type="button"
                aria-pressed={e.slug === exam.slug}
                onClick={() => setSlug(e.slug)}
                className={chip}
              >
                {e.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl border border-ink/8 bg-card p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-ink">{exam.body}</span> · {exam.covers}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Rules from{" "}
          <a
            href={exam.source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-signal-ink underline-offset-2 hover:underline"
          >
            {exam.source.title}
            <ExternalLink className="size-3" />
          </a>{" "}
          ({exam.source.date}), checked {exam.checked}. Always match the notice for your exam cycle.
        </p>

        {exam.notes?.length ? (
          <ul className="mt-3 space-y-1.5">
            {exam.notes.map((n) => (
              <li key={n} className="flex gap-2 text-sm text-ink">
                <Info className="mt-0.5 size-4 shrink-0 text-signal" />
                {n}
              </li>
            ))}
          </ul>
        ) : null}

        {hasPhoto ? (
          <label className="mt-4 flex items-center gap-2 border-t border-ink/10 pt-4 text-sm text-ink">
            <input
              type="checkbox"
              checked={stamp}
              onChange={(e) => setStamp(e.target.checked)}
              className="size-4 accent-[var(--color-signal,#0f766e)]"
            />
            Print my name and the photo date under the photo
            <span className="text-muted-foreground">(only if your form asks for it)</span>
          </label>
        ) : null}

        {hasPhoto && stamp ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_12rem]">
            <label className="space-y-1">
              <span className="text-sm font-medium text-ink">Name printed under the photo</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name as on the form"
                maxLength={40}
                className="h-9"
              />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium text-ink">Date photo was taken</span>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-9"
              />
            </label>
          </div>
        ) : null}
      </div>

      {shared && !hasPhoto && !sharedAsFirst ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-signal/30 bg-signal/5 px-4 py-3 text-sm text-ink">
          <Info className="size-4 shrink-0 text-signal" />
          <span className="min-w-0 flex-1">
            {exam.name} has no photo to upload. Pick another exam for <strong>{shared.name}</strong>, or use it as the {exam.slots[0].label.toLowerCase()}.
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => setSharedFor(exam.slug)}>
            Use as {exam.slots[0].label.toLowerCase()}
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            onClick={() => setShared(null)}
            aria-label="Dismiss shared image"
          >
            <X />
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        {exam.slots.map((slot, i) => (
          <SlotCard
            incoming={
              (hasPhoto ? slot.kind === "photo" : sharedAsFirst && i === 0) ? shared : null
            }
            key={`${exam.slug}-${slot.kind}`}
            exam={exam}
            slot={slot}
            stamp={stamp}
            name={name}
            date={printedDate(date)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Your photos are resized inside this tab. Nothing is uploaded, and the page works offline once loaded.
      </p>
    </div>
  );
}

function SlotCard({
  exam,
  slot,
  incoming,
  stamp,
  name,
  date,
}: {
  exam: ExamSpec;
  slot: SlotSpec;
  incoming: File | null;
  stamp: boolean;
  name: string;
  date: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [framing, setFraming] = useState<CropFraming>(CENTER);
  const [result, setResult] = useState<RenderResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trim, setTrim] = useState(true);
  const framed = usesFraming(slot);
  // Only a photo carries the name and date, so other slots ignore typing in those fields.
  const stamped = stamp && slot.kind === "photo";
  const stampName = stamped ? name : "";
  const stampDate = stamped ? date : "";

  useEffect(() => () => bitmap?.close(), [bitmap]);

  useEffect(() => {
    if (incoming) void pick(incoming);
  }, [incoming]);

  useEffect(() => {
    if (!bitmap) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setBusy(true);
      try {
        const out = await renderSlot(bitmap, slot, {
          framing,
          stamp: stamped,
          trim,
          name: stampName,
          date: stampDate,
        });
        if (!cancelled) {
          setResult(out);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setResult(null);
          setError(e instanceof Error ? e.message : "Could not make this image.");
        }
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bitmap, slot, framing, trim, stamped, stampName, stampDate]);

  const url = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
      setError("Use a JPG, PNG or WebP image. On iPhone, share the photo as JPG or take a screenshot of it.");
      return;
    }
    try {
      const next = await openImage(file);
      setFraming(CENTER);
      setTrim(true);
      setBitmap(next);
      setError(null);
    } catch {
      setError("This file could not be opened as an image. Use a JPG, PNG or WebP.");
    }
  }

  function clear() {
    setBitmap(null);
    setResult(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  // Dragging the preview pans the crop so the photo follows the pointer one to one.
  const drag = useRef<{ x: number; y: number; start: CropFraming; perX: number; perY: number } | null>(null);
  function onPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (!framed || !bitmap) return;
    const box = e.currentTarget.getBoundingClientRect();
    // The photo fills only the area above the name band, so measure against that.
    const area = photoArea(slot, stamped);
    const crop = coverCrop(bitmap.width, bitmap.height, area.width, area.height, framing);
    const shownHeight = (box.height * area.height) / slot.height;
    const freeX = bitmap.width - crop.width;
    const freeY = bitmap.height - crop.height;
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      start: framing,
      // Framing units per screen pixel: source pixels per preview pixel, over the free space.
      perX: freeX > 0 ? crop.width / box.width / freeX : 0,
      perY: freeY > 0 ? crop.height / shownHeight / freeY : 0,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    setFraming({
      zoom: d.start.zoom,
      x: clamp(d.start.x - (e.clientX - d.x) * d.perX),
      y: clamp(d.start.y - (e.clientY - d.y) * d.perY),
    });
  }
  function onPointerUp() {
    drag.current = null;
  }

  const allOk = result?.checks.every((c) => c.ok) ?? false;
  const stampMissing = stamped && !name.trim();

  return (
    <section className="flex flex-col rounded-2xl border border-ink/8 bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">{slot.label}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {slot.width} × {slot.height} px · {kbRange(slot)} · JPG
            {slot.dpi ? ` · ${slot.dpi} DPI` : ""}
          </p>
        </div>
        {bitmap ? (
          <Button type="button" size="icon-sm" variant="ghost" onClick={clear} aria-label={`Remove ${slot.label}`}>
            <X />
          </Button>
        ) : null}
      </div>

      {slot.rules?.length ? (
        <ul className="mt-3 space-y-1 text-xs leading-relaxed text-muted-foreground">
          {slot.rules.map((r) => (
            <li key={r} className="flex gap-1.5">
              <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-ink/30" />
              {r}
            </li>
          ))}
        </ul>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        className="sr-only"
        aria-label={`Choose ${slot.label}`}
        onChange={(e) => void pick(e.target.files?.[0])}
      />

      {!bitmap ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void pick(e.dataTransfer.files[0]);
          }}
          className="pressable mt-4 flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ink/20 bg-secondary/60 px-4 text-sm text-ink hover:border-ink/40"
        >
          <ImagePlus className="size-5 text-signal" />
          <span className="font-medium">Choose {slot.kind === "photo" ? "a photo" : "an image"}</span>
          <span className="text-xs text-muted-foreground">
            {slot.kind === "photo" ? "A clear, front-facing photo" : "A photo or scan on plain white paper"}
          </span>
        </button>
      ) : null}

      {!bitmap && error ? (
        <p role="alert" className="mt-3 flex gap-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      {bitmap ? (
        <div
          className={cn(
            "mt-4 grid gap-4",
            slot.width / slot.height < 1.8 && "sm:grid-cols-[auto_1fr]",
          )}
        >
          <div className="flex flex-col items-center gap-2">
            <div
              className={cn(
                "relative grid min-h-24 min-w-24 place-items-center overflow-hidden rounded-lg border border-ink/10 bg-secondary",
                framed && "cursor-grab touch-none active:cursor-grabbing",
              )}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element -- a local blob preview
                <img
                  src={url}
                  alt={`${slot.label} preview`}
                  draggable={false}
                  style={{
                    width:
                      slot.width / slot.height < 1.8
                        ? Math.min(slot.width, 160)
                        : Math.min(slot.width, 320),
                    aspectRatio: `${slot.width} / ${slot.height}`,
                  }}
                  className="max-w-[60vw] select-none"
                />
              ) : error ? (
                <AlertTriangle className="size-5 text-destructive" aria-hidden />
              ) : (
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              )}
              {busy && url ? (
                <Loader2 className="absolute top-1.5 right-1.5 size-4 animate-spin text-muted-foreground" />
              ) : null}
            </div>
            {framed ? (
              <p className="text-xs text-muted-foreground">Drag to move</p>
            ) : (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={trim}
                  onChange={(e) => setTrim(e.target.checked)}
                  className="size-3.5 accent-[var(--color-signal,#0f766e)]"
                />
                Trim to the ink
              </label>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            {framed ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <label htmlFor={`${exam.slug}-${slot.kind}-zoom`} className="font-medium text-ink">
                    Zoom
                  </label>
                  <button
                    type="button"
                    onClick={() => setFraming(CENTER)}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    <RotateCcw className="size-3" />
                    Reset
                  </button>
                </div>
                <input
                  id={`${exam.slug}-${slot.kind}-zoom`}
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={framing.zoom}
                  onChange={(e) => setFraming({ ...framing, zoom: Number(e.target.value) })}
                  className="h-8 w-full accent-[var(--color-signal,#0f766e)]"
                />
              </div>
            ) : null}

            {result ? (
              <ul className="space-y-1.5" aria-label={`${slot.label} checks`}>
                {result.checks.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-sm">
                    {c.ok ? (
                      <CheckIcon className="size-4 shrink-0 text-signal" aria-label="passes" />
                    ) : (
                      <X className="size-4 shrink-0 text-destructive" aria-label="fails" />
                    )}
                    <span className="text-ink">{c.label}</span>
                    <span className="ml-auto text-right tabular-nums text-muted-foreground">
                      {c.value}
                      <span className="text-ink/35"> / {c.wanted}</span>
                    </span>
                  </li>
                ))}
                {stamped ? (
                  <li className="flex items-center gap-2 text-sm">
                    {stampMissing ? (
                      <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-label="missing" />
                    ) : (
                      <CheckIcon className="size-4 shrink-0 text-signal" aria-label="passes" />
                    )}
                    <span className="text-ink">Name and date</span>
                    <span className="ml-auto text-muted-foreground">
                      {stampMissing ? "Type your name above" : "Printed"}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : null}

            {error ? (
              <p className="flex gap-2 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            ) : null}

            {result && url ? (
              <Button asChild className="w-full" variant={allOk && !stampMissing ? "default" : "outline"}>
                <a href={url} download={`${exam.slug}-${slot.kind}.jpg`}>
                  <Download />
                  Download {slot.label.toLowerCase()}
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
