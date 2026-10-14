import type { FontFile } from "./model";
import { familyName, stripSubset } from "./fonts";
import { mayEmbed, mergeSubsets, readSfnt, retarget, TRUETYPE, unicodeMap, withoutPrivateCopies, type Sfnt } from "./sfnt";

/** A font file ready for the docx: renamed to the family the runs use, in the face it stands for. */
export type EmbeddedFont = FontFile;

export type FontInput = { name: string; data: Uint8Array | undefined; bold: boolean; italic: boolean };

/** Fonts every PDF reader supplies itself; a PDF that names them has usually not embedded them. */
const READER_FONTS = /^(helvetica|times|courier|arial|symbol|zapfdingbats)/i;

type Face = { family: string; bold: boolean; italic: boolean; font: Sfnt };

/**
 * Gathers the fonts a PDF embeds so the Word file can carry them. Subsets of the same face are joined,
 * and each run is told which family name to use so Word finds the embedded copy.
 */
export class FontCollector {
  private faces: Face[] = [];
  private byId = new Map<string, string | null>();

  /** The family name runs set in this font should use, or null when the font cannot be embedded. */
  add(id: string, input: FontInput): string | null {
    if (this.byId.has(id)) return this.byId.get(id)!;
    const name = this.embed(input);
    this.byId.set(id, name);
    return name;
  }

  private embed({ name, data, bold, italic }: FontInput): string | null {
    if (!data) return null;
    // A name without a subset tag and a reader's own font means pdf.js stood in its own copy.
    if (stripSubset(name) === name && READER_FONTS.test(name)) return null;
    const font = readSfnt(data);
    if (!font || font.flavor !== TRUETYPE || !mayEmbed(font.tables)) return null;
    if (!withoutPrivateCopies(unicodeMap(font.tables.get("cmap"))).size) return null;
    const family = embedFamily(name);
    if (!family) return null;
    const same = this.faces.filter((f) => f.bold === bold && f.italic === italic && baseOf(f.family) === family);
    for (const face of same) {
      const merged = mergeSubsets(face.font, font);
      if (merged) {
        face.font = merged;
        return face.family;
      }
    }
    // Something else under the same name (a different cut): give it a name of its own.
    const own = same.length ? `${family} ${same.length + 1}` : family;
    this.faces.push({ family: own, bold, italic, font });
    return own;
  }

  fonts(): EmbeddedFont[] {
    return this.faces.map((f) => ({
      family: f.family,
      bold: f.bold,
      italic: f.italic,
      data: retarget(f.font, f.family, f, unicodeMap(f.font.tables.get("cmap"))),
    }));
  }
}

const baseOf = (family: string) => family.replace(/ \d+$/, "");

/** The family a run names: the standard name Word knows, else what the PDF calls the font. */
export function embedFamily(pdfName: string): string {
  const family = familyName(pdfName);
  return family.replace(/[<>&"]/g, "").trim();
}
