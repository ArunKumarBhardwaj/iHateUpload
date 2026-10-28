/**
 * Kruti Dev / DevLys -> Unicode Devanagari.
 *
 * Kruti Dev 010 and DevLys 010 are legacy "remapped" fonts: Hindi is typed as Latin letters and the
 * font draws Devanagari shapes for them, so a sheet stores "vkt fnukad" for "आज दिनांक". Any other
 * font prints the Latin letters. This turns such text into real Unicode Hindi.
 *
 * The mapping is the classic, widely used Kruti Dev 010 table, applied in its order (earlier,
 * longer sequences win). Two things are typed out of logical order and are reordered here:
 *  - "f" (the ि matra) is typed before the letter cluster it follows;
 *  - "Z" (the reph, र्) is typed after the cluster (and its matras) it precedes.
 * Both are moved by whole conjunct clusters (e.g. स्थि, र्द्ध), not by a single character.
 */

/** Font names whose text is Kruti Dev encoded. */
export function isKrutiDevFont(name: string | undefined): boolean {
  return !!name && /kruti\s*dev|devlys/i.test(name);
}

const PAIRS: [string, string][] = [
  ["ñ", "॰"], ["Q+Z", "QZ+"], ["sas", "sa"], ["aa", "a"], [")Z", "र्द्ध"], ["ZZ", "Z"],
  ["‘", '"'], ["’", '"'], ["“", "'"], ["”", "'"],
  ["å", "०"], ["ƒ", "१"], ["„", "२"], ["…", "३"], ["†", "४"], ["‡", "५"], ["ˆ", "६"], ["‰", "७"], ["Š", "८"], ["‹", "९"],
  ["¶+", "फ़्"], ["d+", "क़"], ["[+k", "ख़"], ["[+", "ख़्"], ["x+", "ग़"], ["T+", "ज़्"], ["t+", "ज़"], ["M+", "ड़"], ["<+", "ढ़"],
  ["Q+", "फ़"], [";+", "य़"], ["j+", "ऱ"], ["u+", "ऩ"],
  ["Ùk", "त्त"], ["Ù", "त्त्"], ["ä", "क्त"], ["–", "दृ"], ["—", "कृ"], ["é", "न्न"], ["™", "न्न्"], ["=kk", "=k"], ["f=k", "f="],
  ["à", "ह्न"], ["á", "ह्य"], ["â", "हृ"], ["ã", "ह्म"], ["ºz", "ह्र"], ["º", "ह्"], ["í", "द्द"], ["{k", "क्ष"], ["{", "क्ष्"],
  ["=", "त्र"], ["«", "त्र्"],
  ["Nî", "छ्य"], ["Vî", "ट्य"], ["Bî", "ठ्य"], ["Mî", "ड्य"], ["<î", "ढ्य"], ["|", "द्य"], ["K", "ज्ञ"], ["}", "द्व"],
  ["J", "श्र"], ["Vª", "ट्र"], ["Mª", "ड्र"], ["<ªª", "ढ्र"], ["Nª", "छ्र"], ["Ø", "क्र"], ["Ý", "फ्र"], ["nzZ", "र्द्र"],
  ["æ", "द्र"], ["ç", "प्र"], ["Á", "प्र"], ["xz", "ग्र"], ["#", "रु"], [":", "रू"],
  ["v‚", "ऑ"], ["vks", "ओ"], ["vkS", "औ"], ["vk", "आ"], ["v", "अ"], ["b±", "ईं"], ["Ã", "ई"], ["bZ", "ई"], ["b", "इ"],
  ["m", "उ"], ["Å", "ऊ"], [",s", "ऐ"], [",", "ए"], ["_", "ऋ"],
  ["ô", "क्क"], ["d", "क"], ["Dk", "क"], ["D", "क्"], ["[k", "ख"], ["[", "ख्"], ["x", "ग"], ["Xk", "ग"], ["X", "ग्"],
  ["Ä", "घ"], ["?k", "घ"], ["?", "घ्"], ["³", "ङ"],
  ["pkS", "चै"], ["p", "च"], ["Pk", "च"], ["P", "च्"], ["N", "छ"], ["t", "ज"], ["Tk", "ज"], ["T", "ज्"], [">", "झ"], ["÷", "झ्"], ["¥", "ञ"],
  ["ê", "ट्ट"], ["ë", "ट्ठ"], ["V", "ट"], ["B", "ठ"], ["ì", "ड्ड"], ["ï", "ड्ढ"], ["M", "ड"], ["<", "ढ"], [".k", "ण"], [".", "ण्"],
  ["r", "त"], ["Rk", "त"], ["R", "त्"], ["Fk", "थ"], ["F", "थ्"], [")", "द्ध"], ["n", "द"], ["/k", "ध"], ["èk", "ध"], ["/", "ध्"],
  ["Ë", "ध्"], ["è", "ध्"], ["u", "न"], ["Uk", "न"], ["U", "न्"],
  ["i", "प"], ["Ik", "प"], ["I", "प्"], ["Q", "फ"], ["¶", "फ्"], ["c", "ब"], ["Ck", "ब"], ["C", "ब्"], ["Hk", "भ"], ["H", "भ्"],
  ["e", "म"], ["Ek", "म"], ["E", "म्"],
  [";", "य"], ["¸", "य्"], ["j", "र"], ["y", "ल"], ["Yk", "ल"], ["Y", "ल्"], ["G", "ळ"], ["o", "व"], ["Ok", "व"], ["O", "व्"],
  ["'k", "श"], ["'", "श्"], ['"k', "ष"], ['"', "ष्"], ["l", "स"], ["Lk", "स"], ["L", "स्"], ["g", "ह"],
  ["È", "ीं"], ["z", "्र"],
  ["Ì", "द्द"], ["Í", "ट्ट"], ["Î", "ट्ठ"], ["Ï", "ड्ड"], ["Ñ", "कृ"], ["Ò", "भ"], ["Ó", "्य"], ["Ô", "ड्ढ"], ["Ö", "झ्"],
  ["Ük", "श"], ["Ü", "श्"],
  ["‚", "ॉ"], ["ks", "ो"], ["kS", "ौ"], ["k", "ा"], ["h", "ी"], ["q", "ु"], ["w", "ू"], ["`", "ृ"], ["s", "े"], ["S", "ै"],
  ["a", "ं"], ["¡", "ँ"], ["%", "ः"], ["W", "ॅ"], ["•", "ऽ"], ["·", "ऽ"], ["∙", "ऽ"], ["~j", "्र"], ["~", "्"], ["\\", "?"],
  ["+", "़"], [" ः", ":"],
  ["^", "‘"], ["*", "’"], ["Þ", "“"], ["ß", "”"], ["(", ";"], ["¼", "("], ["½", ")"], ["¿", "{"], ["À", "}"], ["¾", "="],
  ["A", "।"], ["-", "."], ["&", "-"], ["Œ", "॰"], ["]", ","], ["@", "/"],
];

const isConsonant = (c: string | undefined) => !!c && /[क-हक़-य़ॸ-ॿ]/.test(c);
const NUKTA = "़";
const HALANT = "्";
const I_MATRA = "ि";
/** dependent vowel signs and the marks that follow them */
const isMark = (c: string | undefined) => !!c && /[ा-ौँ-ःॅॉॢॣ]/.test(c);

/** End (exclusive) of the consonant cluster starting at i: C (़)? ( ् C (़)? )* */
function clusterEnd(s: string[], i: number): number {
  let j = i;
  if (!isConsonant(s[j])) return i;
  j++;
  if (s[j] === NUKTA) j++;
  while (s[j] === HALANT && isConsonant(s[j + 1])) {
    j += 2;
    if (s[j] === NUKTA) j++;
  }
  return j;
}

/** Start of the consonant cluster that ends (exclusive) at end. */
function clusterStart(s: string[], end: number): number {
  let i = end - 1;
  if (s[i] === NUKTA) i--;
  if (!isConsonant(s[i])) return end;
  while (s[i - 1] === HALANT && isConsonant(s[i - 2]) || (s[i - 1] === HALANT && s[i - 2] === NUKTA && isConsonant(s[i - 3]))) {
    i -= s[i - 2] === NUKTA ? 3 : 2;
  }
  return i;
}

/** "f" + [ं] + cluster -> cluster + ि + [ं] */
function placeI(text: string): string {
  const s = Array.from(text);
  const out: string[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "f") {
      out.push(s[i]);
      continue;
    }
    let j = i + 1;
    const anusvara = s[j] === "ं";
    if (anusvara) j++;
    // a reph typed between ि and its letter belongs before the letter
    let reph = "";
    if (s[j] === "र" && s[j + 1] === HALANT && isConsonant(s[j + 2])) {
      reph = "र्";
      j += 2;
    }
    const end = clusterEnd(s, j);
    if (end === j) {
      out.push(I_MATRA, ...(anusvara ? ["ं"] : []));
      i = j - 1;
      continue;
    }
    out.push(reph, ...s.slice(j, end), I_MATRA, ...(anusvara ? ["ं"] : []));
    i = end - 1;
  }
  return out.join("");
}

/** cluster + matras + "Z" -> "र्" + cluster + matras */
function placeReph(text: string): string {
  const s = Array.from(text);
  for (let z = s.indexOf("Z"); z !== -1; z = s.indexOf("Z")) {
    let k = z;
    while (k > 0 && isMark(s[k - 1])) k--;
    const start = clusterStart(s, k);
    s.splice(z, 1);
    if (start < k) s.splice(start, 0, "र", HALANT);
    else s.splice(z, 0, "र", HALANT); // nothing to attach to: keep it where it was
  }
  return s.join("");
}

export function krutiToUnicode(input: string): string {
  if (!input) return input;
  let s = input;
  for (const [from, to] of PAIRS) if (s.includes(from)) s = s.split(from).join(to);
  s = s.replace(/±/g, "Zं").replace(/Æ/g, "र्f");
  s = s.replace(/[Ç¯]/g, "fं").replace(/É/g, "र्fं");
  s = s.replace(/Ê/g, "ीZ");
  s = placeI(s);
  s = s.replace(/्Z/g, "Z");
  s = placeReph(s);
  // a matra can't follow a space or a halant
  s = s.replace(/ ([ा-ौ])/g, "$1").replace(/््/g, "्");
  // "kW" (ा + ॅ) is how ॉ is usually typed in Kruti Dev, as in स्टॉक
  s = s.replace(/ाॅ|ॅा/g, "ॉ");
  return s.normalize("NFC");
}
