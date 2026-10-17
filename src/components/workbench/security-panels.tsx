"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { FileItem } from "@/lib/job";
import { passwordStrength } from "@/lib/protect";
import { OCR_LANGUAGES, type ToolOptions } from "@/lib/tool-options";
import { probeLock } from "@/lib/unlock";
import { cn } from "@/lib/utils";

const OPTION_BUTTON = "h-10 sm:h-7";

export function PasswordField({
  id,
  label,
  value,
  onChange,
  disabled,
  placeholder,
  autoComplete,
  invalid,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  placeholder: string;
  autoComplete: string;
  invalid?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-ink" htmlFor={id}>
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={invalid}
          className="pr-11"
        />
        <button
          type="button"
          aria-label={shown ? "Hide password" : "Show password"}
          aria-pressed={shown}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-ink"
          onClick={() => setShown(!shown)}
        >
          {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </div>
  );
}

function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  if (!password) return null;
  const tone =
    score <= 1 ? "bg-red-500" : score === 2 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="space-y-1" aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full bg-ink/10",
              i < Math.max(1, score) && tone,
            )}
          />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Strength: {label}</p>
    </div>
  );
}

export function ProtectPanel({
  options,
  onOptions,
  confirmPassword,
  onConfirmPassword,
  disabled,
}: {
  options: Extract<ToolOptions, { kind: "protect" }>;
  onOptions: (next: ToolOptions) => void;
  confirmPassword: string;
  onConfirmPassword: (next: string) => void;
  disabled: boolean;
}) {
  const mismatch =
    confirmPassword.length > 0 && options.password !== confirmPassword;
  const perms = [
    ["allowPrint", "Printing"],
    ["allowCopy", "Copying text and images"],
    ["allowEdit", "Editing and rearranging pages"],
    ["allowAnnotate", "Comments and filling forms"],
  ] as const;
  const restricted = perms.some(([key]) => !options[key]);
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <PasswordField
          id="pdf-password"
          label="Password to open"
          value={options.password}
          onChange={(password) => onOptions({ ...options, password })}
          disabled={disabled}
          placeholder="Choose a password"
          autoComplete="new-password"
        />
        <StrengthMeter password={options.password} />
      </div>
      <PasswordField
        id="pdf-password-confirm"
        label="Confirm password"
        value={confirmPassword}
        onChange={onConfirmPassword}
        disabled={disabled}
        placeholder="Repeat password"
        autoComplete="new-password"
        invalid={mismatch}
      />
      {mismatch && (
        <p className="text-sm text-destructive">Passwords do not match.</p>
      )}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-ink">
          People who open it may
        </legend>
        {perms.map(([key, title]) => (
          <label key={key} className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="size-4"
              checked={options[key]}
              disabled={disabled}
              onChange={(e) =>
                onOptions({ ...options, [key]: e.target.checked })
              }
            />
            {title}
          </label>
        ))}
      </fieldset>
      {restricted ? (
        <>
          <PasswordField
            id="pdf-owner-password"
            label="Owner password (optional)"
            value={options.ownerPassword}
            onChange={(ownerPassword) => onOptions({ ...options, ownerPassword })}
            disabled={disabled}
            placeholder="Needed to lift the limits later"
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            Leave the owner password empty and a random one is used, so the
            limits cannot be lifted. Leave the open password empty to restrict
            without asking for a password. Limits are honoured by PDF
            readers; the open password is the real lock.
          </p>
        </>
      ) : null}
    </div>
  );
}

export function UnlockPanel({
  options,
  onOptions,
  disabled,
  files,
}: {
  options: Extract<ToolOptions, { kind: "unlock" }>;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
  files?: FileItem[];
}) {
  const first = files?.[0]?.file;
  useEffect(() => {
    if (!first) return;
    let live = true;
    void first
      .arrayBuffer()
      .then((buffer) => probeLock(new Uint8Array(buffer)))
      .then((lock) => {
        if (live) onOptions({ kind: "unlock", password: "", lock });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // The probe belongs to the file, not to every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first]);

  if (options.lock === "restricted") {
    return (
      <div className="space-y-2 rounded-lg border border-signal/25 bg-signal/5 px-3 py-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="size-4 text-signal" />
          No password needed
        </p>
        <p className="text-sm text-muted-foreground">
          This PDF opens freely but carries limits on printing, copying or
          editing. Press Remove restrictions to write a clean copy without
          them.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {options.lock === "open" ? (
        <p className="rounded-lg border border-ink/10 bg-secondary px-3 py-2 text-sm text-muted-foreground">
          This PDF is not locked. Unlocking will still write a clean copy.
        </p>
      ) : null}
      <PasswordField
        id="pdf-password"
        label="Password"
        value={options.password}
        onChange={(password) => onOptions({ ...options, password })}
        disabled={disabled}
        placeholder="PDF password"
        autoComplete="current-password"
      />
    </div>
  );
}

export function ExtractTextPanel({
  options,
  onOptions,
  disabled,
}: {
  options: Extract<ToolOptions, { kind: "extract-text" }>;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-4">
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5 size-4"
          checked={options.ocr}
          disabled={disabled}
          onChange={(e) => onOptions({ ...options, ocr: e.target.checked })}
        />
        <span>
          OCR scanned pages
          <span className="block text-xs text-muted-foreground">
            Only pages with no selectable text are read. Runs in this tab.
          </span>
        </span>
      </label>
      {options.ocr ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-ink">Language</p>
          <div className="flex flex-wrap gap-2">
            {OCR_LANGUAGES.map((language) => (
              <Button
                key={language.id}
                type="button"
                size="sm"
                className={OPTION_BUTTON}
                variant={options.language === language.id ? "default" : "outline"}
                disabled={disabled}
                onClick={() => onOptions({ ...options, language: language.id })}
              >
                {language.title}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

const MIN_EDGES = [
  [0, "All"],
  [32, "32 px+"],
  [64, "64 px+"],
  [200, "200 px+"],
] as const;

export function ExtractImagesPanel({
  options,
  onOptions,
  disabled,
}: {
  options: Extract<ToolOptions, { kind: "extract-images" }>;
  onOptions: (next: ToolOptions) => void;
  disabled: boolean;
}) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-ink">Smallest side</p>
      <div className="flex flex-wrap gap-2">
        {MIN_EDGES.map(([edge, title]) => (
          <Button
            key={edge}
            type="button"
            size="sm"
            className={OPTION_BUTTON}
            variant={options.minEdge === edge ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onOptions({ ...options, minEdge: edge })}
          >
            {title}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Hides icons, bullets and other tiny pictures. JPEGs are kept as they
        are in the PDF, not re-encoded.
      </p>
    </div>
  );
}
