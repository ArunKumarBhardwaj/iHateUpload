"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileItem } from "@/lib/job";
import {
  loadForMetadata,
  parseXmpValues,
  readMetadata,
  type MetaFields,
  type PdfMetadata,
} from "@/lib/pdf-meta";
import type { ToolOptions } from "@/lib/tool-options";

type MetaOptions = Extract<ToolOptions, { kind: "metadata" }>;

const OPTION_BUTTON = "h-10 sm:h-7";

const TEXT_FIELDS: {
  key: "title" | "author" | "subject" | "keywords" | "creator" | "producer";
  label: string;
  hint: string;
}[] = [
  { key: "title", label: "Title", hint: "Shown in the tab and most readers, ahead of the filename" },
  { key: "author", label: "Author", hint: "Often filled in with a computer or account name" },
  { key: "subject", label: "Subject", hint: "A line about what the document is" },
  { key: "keywords", label: "Keywords", hint: "Used by desktop search indexers" },
  { key: "creator", label: "Creator", hint: "The app the document was first written in" },
  { key: "producer", label: "Producer", hint: "The library that wrote the PDF file" },
];

function fieldsOf(meta: PdfMetadata, sourceId: string, xmp: MetaOptions["xmp"]): MetaOptions {
  return {
    kind: "metadata",
    sourceId,
    title: meta.title,
    author: meta.author,
    subject: meta.subject,
    keywords: meta.keywords,
    creator: meta.creator,
    producer: meta.producer,
    created: meta.created,
    modified: meta.modified,
    custom: meta.custom.map((entry) => ({ ...entry })),
    xmp,
  };
}

const COMPARED = [
  "title",
  "author",
  "subject",
  "keywords",
  "creator",
  "producer",
  "created",
  "modified",
] as const;

function changedCount(options: MetaOptions, original: PdfMetadata) {
  let changed = COMPARED.filter((key) => options[key] !== original[key]).length;
  const now = new Map(
    options.custom.filter((e) => e.key.trim()).map((e) => [e.key.trim(), e.value]),
  );
  const was = new Map(original.custom.map((e) => [e.key, e.value]));
  for (const [key, value] of now) if (was.get(key) !== value) changed++;
  for (const key of was.keys()) if (!now.has(key)) changed++;
  if (options.xmp === "remove" && original.xmp !== null) changed++;
  return changed;
}

function ClearableField({
  id,
  label,
  hint,
  value,
  type = "text",
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  type?: string;
  disabled: boolean;
  onChange: (next: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-ink" htmlFor={id}>
          {label}
        </label>
        <button
          type="button"
          className="rounded px-1.5 py-0.5 text-xs text-ink/60 hover:bg-ink/5 hover:text-ink disabled:opacity-40"
          disabled={disabled || value === ""}
          onClick={() => onChange("")}
          aria-label={`Clear ${label}`}
        >
          clear
        </button>
      </div>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder={value === "" ? (hint ?? "Empty") : undefined}
        autoComplete="off"
      />
    </div>
  );
}

export function MetadataEditor({
  options,
  onOptions,
  file,
  disabled,
}: {
  options: MetaOptions;
  onOptions: (next: ToolOptions) => void;
  file: FileItem | undefined;
  disabled: boolean;
}) {
  const [original, setOriginal] = useState<{ id: string; meta: PdfMetadata } | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const [showXmp, setShowXmp] = useState(false);
  const copyInput = useRef<HTMLInputElement>(null);
  const fileId = file?.id;
  const source = file?.file;

  useEffect(() => {
    if (!fileId || !source) return;
    let alive = true;
    void (async () => {
      try {
        const doc = await loadForMetadata(await source.arrayBuffer());
        const meta = readMetadata(doc);
        if (!alive) return;
        setOriginal({ id: fileId, meta });
        setError(null);
        onOptions(fieldsOf(meta, fileId, "update"));
      } catch (e) {
        if (!alive) return;
        setError({
          id: fileId,
          message:
            e instanceof Error ? e.message : "Could not read this PDF's properties.",
        });
      }
    })();
    return () => {
      alive = false;
    };
    // onOptions is a fresh closure every render; the file is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId, source]);

  if (!file) {
    return (
      <p className="text-sm text-ink/70">
        Add a PDF and its title, author, dates and other properties appear here.
      </p>
    );
  }
  if (error?.id === file.id) {
    return <p className="text-sm text-destructive">{error.message}</p>;
  }
  const meta = original?.id === file.id ? original.meta : null;
  if (!meta || options.sourceId !== file.id) {
    return <p className="text-sm text-ink/60">Reading properties…</p>;
  }

  const set = (patch: Partial<MetaOptions>) => onOptions({ ...options, ...patch });
  const changed = changedCount(options, meta);
  const xmpValues = meta.xmp ? parseXmpValues(meta.xmp) : null;
  const xmpRows = xmpValues
    ? (Object.keys(xmpValues) as (keyof MetaFields)[]).filter(
        (key) => xmpValues[key] !== "",
      )
    : [];

  const stripAll = () =>
    onOptions({
      ...options,
      title: "",
      author: "",
      subject: "",
      keywords: "",
      creator: "",
      producer: "",
      created: "",
      modified: "",
      custom: [],
      xmp: "remove",
    });

  const copyFrom = async (from: File) => {
    try {
      const donor = readMetadata(await loadForMetadata(await from.arrayBuffer()));
      onOptions({ ...fieldsOf(donor, file.id, options.xmp), xmp: options.xmp });
    } catch {
      setError({ id: file.id, message: "Could not read that PDF." });
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className={OPTION_BUTTON}
          disabled={disabled}
          onClick={stripAll}
        >
          Strip everything
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={OPTION_BUTTON}
          disabled={disabled || changed === 0}
          onClick={() => onOptions(fieldsOf(meta, file.id, "update"))}
        >
          Revert
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={OPTION_BUTTON}
          disabled={disabled}
          onClick={() => copyInput.current?.click()}
        >
          Copy from a PDF…
        </Button>
        <input
          ref={copyInput}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(event) => {
            const picked = event.target.files?.[0];
            event.target.value = "";
            if (picked) void copyFrom(picked);
          }}
        />
      </div>

      <div className="space-y-3">
        {TEXT_FIELDS.map((field) => (
          <ClearableField
            key={field.key}
            id={`meta-${field.key}`}
            label={field.label}
            hint={field.hint}
            value={options[field.key]}
            disabled={disabled}
            onChange={(next) => set({ [field.key]: next })}
          />
        ))}
        <div className="grid gap-3 sm:grid-cols-2">
          <ClearableField
            id="meta-created"
            label="Created"
            type="datetime-local"
            value={options.created}
            disabled={disabled}
            onChange={(created) => set({ created })}
          />
          <ClearableField
            id="meta-modified"
            label="Modified"
            type="datetime-local"
            value={options.modified}
            disabled={disabled}
            onChange={(modified) => set({ modified })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-ink">Custom properties</p>
        {options.custom.length === 0 ? (
          <p className="text-xs text-ink/60">
            None. Extra Info keys, like Department or CaseNo, would show here.
          </p>
        ) : null}
        {options.custom.map((entry, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              aria-label="Property name"
              value={entry.key}
              disabled={disabled}
              placeholder="Name"
              className="w-2/5"
              onChange={(e) =>
                set({
                  custom: options.custom.map((row, i) =>
                    i === index ? { ...row, key: e.target.value } : row,
                  ),
                })
              }
            />
            <Input
              aria-label="Property value"
              value={entry.value}
              disabled={disabled}
              placeholder="Value"
              onChange={(e) =>
                set({
                  custom: options.custom.map((row, i) =>
                    i === index ? { ...row, value: e.target.value } : row,
                  ),
                })
              }
            />
            <button
              type="button"
              aria-label="Remove property"
              disabled={disabled}
              onClick={() =>
                set({ custom: options.custom.filter((_, i) => i !== index) })
              }
              className="grid size-10 shrink-0 place-items-center rounded-lg text-ink/60 hover:bg-ink/5 hover:text-ink sm:size-8"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={OPTION_BUTTON}
          disabled={disabled}
          onClick={() => set({ custom: [...options.custom, { key: "", value: "" }] })}
        >
          <Plus className="size-3.5" /> Add property
        </Button>
      </div>

      {meta.xmp ? (
        <div className="space-y-2 rounded-lg border border-ink/10 p-3">
          <p className="text-sm font-medium text-ink">
            XMP packet ({meta.xmp.length.toLocaleString()} characters)
          </p>
          <p className="text-xs text-ink/70">
            A second copy of these properties that many readers prefer. Editing
            above keeps it in step, or you can drop it.
          </p>
          {xmpRows.length > 0 ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
              {xmpRows.map((key) => (
                <div key={key} className="contents">
                  <dt className="text-ink/60">{key}</dt>
                  <dd className="min-w-0 break-words text-ink">{xmpValues![key]}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["update", "Keep in step"],
                ["remove", "Remove XMP"],
              ] as const
            ).map(([mode, title]) => (
              <Button
                key={mode}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.xmp === mode ? "default" : "outline"}
                disabled={disabled}
                onClick={() => set({ xmp: mode })}
              >
                {title}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className={OPTION_BUTTON}
              onClick={() => setShowXmp((open) => !open)}
            >
              {showXmp ? "Hide raw XMP" : "Show raw XMP"}
            </Button>
          </div>
          {showXmp ? (
            <pre className="max-h-48 overflow-auto rounded bg-ink/[0.04] p-2 text-[11px] leading-snug text-ink">
              {meta.xmp}
            </pre>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-ink/60">
          This PDF has no XMP packet. Only the Info properties are written.
        </p>
      )}

      <p className="text-sm text-ink/70" aria-live="polite">
        {changed === 0
          ? "No changes yet."
          : `${changed} ${changed === 1 ? "change" : "changes"} will be written. Pages and text are untouched.`}
      </p>
    </div>
  );
}
