// Candidate Excel import (HR > Candidates > Import, POST /api/college/candidates/import). Pure rules so they can be
// tested: header matching, one row -> one candidate, duplicates (same mobile or email) inside the file and against the
// college's existing candidates. Nothing here reads or writes the database.

export const CANDIDATE_IMPORT_HEADERS = ["Name", "Email", "Mobile", "Source", "Referred By", "Address"] as const;
export const MAX_IMPORT_ROWS = 500;

export type ImportSource = "WALK_IN" | "ADVERTISEMENT" | "REFERRAL" | "CAREERS_PAGE";
const SOURCE_WORDS: Record<string, ImportSource> = {
  "": "ADVERTISEMENT", "walk in": "WALK_IN", "walk-in": "WALK_IN", walkin: "WALK_IN",
  advertisement: "ADVERTISEMENT", advt: "ADVERTISEMENT", ad: "ADVERTISEMENT", newspaper: "ADVERTISEMENT", "job portal": "ADVERTISEMENT",
  referral: "REFERRAL", referred: "REFERRAL", reference: "REFERRAL",
  "careers page": "CAREERS_PAGE", website: "CAREERS_PAGE", online: "CAREERS_PAGE",
};

export interface ImportRow { name: string; email: string; mobile: string; source: string; referredBy: string; address: string }
export interface ExistingCandidate { id: string; name: string; email?: string; phone?: string }

export type RowResult =
  | { row: number; ok: true; candidate: { name: string; email: string; phone: string; source: ImportSource; referralName?: string; residenceAddress?: string } }
  | { row: number; ok: false; reason: string; existingId?: string };

/** "+91 98480-12345" / "919848012345" / "09848012345" -> "9848012345"; anything else stays as typed (then refused). */
export function normalizeMobile(raw: string): string {
  const digits = raw.replace(/[\s()-]/g, "").replace(/^\+/, "");
  if (/^91\d{10}$/.test(digits)) return digits.slice(2);
  if (/^0\d{10}$/.test(digits)) return digits.slice(1);
  return digits;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Maps the sheet's header row to the template columns (case / spacing ignored). Missing required -> error text. */
export function matchHeaders(header: string[]): { index: Record<(typeof CANDIDATE_IMPORT_HEADERS)[number], number>; error?: string } {
  const norm = (v: string) => v.trim().toLowerCase().replace(/[^a-z]/g, "");
  const aliases: Record<string, (typeof CANDIDATE_IMPORT_HEADERS)[number]> = {
    name: "Name", candidatename: "Name", fullname: "Name",
    email: "Email", emailid: "Email", mail: "Email",
    mobile: "Mobile", mobileno: "Mobile", phone: "Mobile", phoneno: "Mobile", mobilenumber: "Mobile", contact: "Mobile",
    source: "Source", referredby: "Referred By", referral: "Referred By", address: "Address",
  };
  const index = { Name: -1, Email: -1, Mobile: -1, Source: -1, "Referred By": -1, Address: -1 };
  header.forEach((h, i) => { const k = aliases[norm(h)]; if (k && index[k] === -1) index[k] = i; });
  const missing = (["Name", "Email", "Mobile"] as const).filter((k) => index[k] === -1);
  return { index, ...(missing.length ? { error: `The sheet needs these columns: ${missing.join(", ")}.` } : {}) };
}

/**
 * Checks every row. A row is refused for a missing / bad value, a mobile or email already used by an earlier row of
 * the file, or one already in the college's candidate pool (that candidate is named, so HR can attach them instead).
 */
export function checkRows(rows: ImportRow[], existing: ExistingCandidate[]): RowResult[] {
  const byPhone = new Map(existing.filter((c) => c.phone).map((c) => [String(c.phone), c]));
  const byEmail = new Map(existing.filter((c) => c.email).map((c) => [String(c.email).toLowerCase(), c]));
  const seenPhone = new Map<string, number>(), seenEmail = new Map<string, number>();
  return rows.map((r, i) => {
    const row = i + 2; // the sheet's own row number (row 1 is the header)
    const name = r.name.trim().replace(/\s+/g, " ");
    const email = r.email.trim().toLowerCase();
    const phone = normalizeMobile(r.mobile.trim());
    if (!name) return { row, ok: false, reason: "Enter the candidate's name." };
    if (!EMAIL.test(email)) return { row, ok: false, reason: "Enter a valid email." };
    if (!/^[6-9]\d{9}$/.test(phone)) return { row, ok: false, reason: "Enter a 10-digit mobile number starting 6-9." };
    const source = SOURCE_WORDS[r.source.trim().toLowerCase()];
    if (!source) return { row, ok: false, reason: "Source must be Walk-in, Advertisement, Referral or Careers Page." };
    const dupPhone = seenPhone.get(phone), dupEmail = seenEmail.get(email);
    if (dupPhone) return { row, ok: false, reason: `Same mobile as row ${dupPhone} of this file.` };
    if (dupEmail) return { row, ok: false, reason: `Same email as row ${dupEmail} of this file.` };
    const old = byPhone.get(phone) ?? byEmail.get(email);
    if (old) return { row, ok: false, reason: `Already a candidate (${old.name}). Attach them from Candidates instead.`, existingId: old.id };
    seenPhone.set(phone, row); seenEmail.set(email, row);
    return {
      row, ok: true,
      candidate: {
        name, email, phone, source,
        ...(source === "REFERRAL" && r.referredBy.trim() ? { referralName: r.referredBy.trim() } : {}),
        ...(r.address.trim() ? { residenceAddress: r.address.trim() } : {}),
      },
    };
  });
}
