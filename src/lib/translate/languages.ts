/** Target languages we can draw: their script decides which bundled font sets the words. */
export type Script = "latin" | "cyrillic" | "greek" | "devanagari";

export type TargetLanguage = { code: string; name: string; script: Script };

export const TARGET_LANGUAGES: TargetLanguage[] = [
  { code: "en", name: "English", script: "latin" },
  { code: "es", name: "Spanish", script: "latin" },
  { code: "fr", name: "French", script: "latin" },
  { code: "de", name: "German", script: "latin" },
  { code: "pt", name: "Portuguese", script: "latin" },
  { code: "it", name: "Italian", script: "latin" },
  { code: "nl", name: "Dutch", script: "latin" },
  { code: "pl", name: "Polish", script: "latin" },
  { code: "tr", name: "Turkish", script: "latin" },
  { code: "id", name: "Indonesian", script: "latin" },
  { code: "vi", name: "Vietnamese", script: "latin" },
  { code: "sv", name: "Swedish", script: "latin" },
  { code: "da", name: "Danish", script: "latin" },
  { code: "no", name: "Norwegian", script: "latin" },
  { code: "fi", name: "Finnish", script: "latin" },
  { code: "cs", name: "Czech", script: "latin" },
  { code: "ro", name: "Romanian", script: "latin" },
  { code: "hu", name: "Hungarian", script: "latin" },
  { code: "ru", name: "Russian", script: "cyrillic" },
  { code: "uk", name: "Ukrainian", script: "cyrillic" },
  { code: "el", name: "Greek", script: "greek" },
  { code: "hi", name: "Hindi", script: "devanagari" },
  { code: "mr", name: "Marathi", script: "devanagari" },
  { code: "ne", name: "Nepali", script: "devanagari" },
];

export function targetLanguage(code: string): TargetLanguage {
  const found = TARGET_LANGUAGES.find((l) => l.code === code);
  if (!found) throw new Error("Pick a language to translate into.");
  return found;
}

/**
 * Bundled fonts in public/fonts. Liberation Sans covers Latin, Cyrillic and
 * Greek; Caladea gives serif text a serif face in Latin-script languages.
 */
export function fontFiles(script: Script, serif = false): { regular: string; bold: string } {
  if (script === "devanagari") return { regular: "NotoSansDevanagari-Regular.ttf", bold: "NotoSansDevanagari-Bold.ttf" };
  if (serif && script === "latin") return { regular: "Caladea-Regular.ttf", bold: "Caladea-Bold.ttf" };
  return { regular: "LiberationSans-Regular.ttf", bold: "LiberationSans-Bold.ttf" };
}
