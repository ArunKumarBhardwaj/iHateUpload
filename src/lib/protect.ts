export type ProtectChoices = {
  password: string;
  ownerPassword: string;
  allowPrint: boolean;
  allowCopy: boolean;
  allowEdit: boolean;
  allowAnnotate: boolean;
};

function randomPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Arguments for pdf-lib's `encrypt`. Accessibility readers are never blocked. */
export function encryptionFor(choices: ProtectChoices) {
  const restricted =
    !choices.allowPrint ||
    !choices.allowCopy ||
    !choices.allowEdit ||
    !choices.allowAnnotate;
  // The owner password is what lifts the limits. If it matched the open
  // password, anyone who can open the file could lift them, so a restricted
  // file with no owner password gets a random one nobody knows.
  const owner =
    choices.ownerPassword ||
    (restricted && choices.password === "" ? randomPassword() : "") ||
    (restricted ? randomPassword() : choices.password);
  return {
    userPassword: choices.password,
    ownerPassword: owner,
    permissions: {
      printing: choices.allowPrint ? ("highResolution" as const) : false,
      modifying: choices.allowEdit,
      documentAssembly: choices.allowEdit,
      copying: choices.allowCopy,
      annotating: choices.allowAnnotate,
      fillingForms: choices.allowAnnotate,
      contentAccessibility: true,
    },
  };
}

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string };

const COMMON = ["password", "qwerty", "letmein", "123456", "abc123", "welcome", "admin", "iloveyou", "111111"];

/** A rough, local-only estimate. It never leaves the page. */
export function passwordStrength(password: string): Strength {
  if (!password) return { score: 0, label: "" };
  const lower = password.toLowerCase();
  if (COMMON.some((word) => lower.includes(word)) && password.length < 14) {
    return { score: 0, label: "Too easy to guess" };
  }
  let pool = 0;
  if (/[a-z]/.test(password)) pool += 26;
  if (/[A-Z]/.test(password)) pool += 26;
  if (/[0-9]/.test(password)) pool += 10;
  if (/[^A-Za-z0-9]/.test(password)) pool += 32;
  const unique = new Set(password).size;
  const bits = Math.log2(pool || 1) * Math.min(password.length, unique * 2);
  if (bits < 28) return { score: 0, label: "Very weak" };
  if (bits < 45) return { score: 1, label: "Weak" };
  if (bits < 62) return { score: 2, label: "Fair" };
  if (bits < 80) return { score: 3, label: "Strong" };
  return { score: 4, label: "Very strong" };
}
