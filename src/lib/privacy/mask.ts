// Masking helpers for identity and bank numbers (Aadhaar, PAN, passport, bank account, UAN).
//
// Use them wherever a list or summary needs to show that a number exists without
// exposing it (role-based projections, exports for roles that don't need the full value).
// Never use them to store data - the stored value stays complete.

/** Keeps the last `visible` characters, masks the rest ("XXXXXXXX1234"). Empty in, empty out. */
export function maskTail(value: string | null | undefined, visible = 4): string {
  const v = (value ?? "").replace(/\s+/g, "");
  if (!v) return "";
  if (v.length <= visible) return "X".repeat(v.length);
  return "X".repeat(v.length - visible) + v.slice(-visible);
}

/** Aadhaar as the printed card style: "XXXX XXXX 1234". */
export function maskAadhaar(value: string | null | undefined): string {
  const m = maskTail(value, 4);
  return m.length === 12 ? `${m.slice(0, 4)} ${m.slice(4, 8)} ${m.slice(8)}` : m;
}

/** Fields that identify a person financially or officially, by the names used in src/types. */
export const SENSITIVE_ID_FIELDS = [
  "aadharNo",
  "panNo",
  "passportNo",
  "bankAccountNumber",
  "bankAccountNo",
  "uanNumber",
  "pfNumber",
] as const;

/** A shallow copy with every sensitive id field masked; other fields pass through untouched. */
export function maskSensitiveIds<T extends Record<string, unknown>>(record: T): T {
  const out: Record<string, unknown> = { ...record };
  for (const f of SENSITIVE_ID_FIELDS) {
    const v = out[f];
    if (typeof v === "string" && v) out[f] = f === "aadharNo" ? maskAadhaar(v) : maskTail(v, 4);
  }
  return out as T;
}
