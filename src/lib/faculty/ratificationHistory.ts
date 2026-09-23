// Ratification History - the historical record of a faculty member's
// (state/university) ratification, potentially at more than one designation
// across their career (e.g. ratified once as Assistant Professor, again years
// later as Associate Professor). Each entry's designation is a plain
// historical fact captured at the time of THAT ratification - it must NEVER
// be compared with, restricted by, or kept in sync with the faculty member's
// current/ongoing `designation` field (types/core.ts). A later promotion or
// demotion must never alter any existing ratification entry.
//
// Pure functions only (no Firestore, no React) - mirrors promotionHistory.ts.

import { toDateInputValue } from "@/lib/utils";
import type { RatificationRecord } from "@/types";

type Doc = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// Reads a facultyMembers doc's ratification history for the edit/view forms.
// A doc saved before `ratifications` existed still carries the old flat
// ratificationProceedingsNumber/ratificationDate fields with no designation -
// shown here as a single entry (Designation left blank) so nothing already on
// file is silently dropped; saving the Personal Details form migrates it to
// the array shape.
export function ratificationRecordsFromDoc(m: Doc): RatificationRecord[] {
  if (Array.isArray(m.ratifications)) {
    return (m.ratifications as Doc[]).map((r) => ({
      designation: str(r.designation),
      proceedingsNumber: str(r.proceedingsNumber),
      date: str(r.date),
    }));
  }
  const proceedingsNumber = str(m.ratificationProceedingsNumber);
  const date = toDateInputValue(m.ratificationDate as never) || "";
  if (!proceedingsNumber && !date) return [];
  return [{ designation: "", proceedingsNumber, date }];
}

// Rows as they should be stored: trimmed, and with wholly-blank rows (e.g. an
// "Add More" row left empty) dropped. Every field is always a plain string
// (never `undefined`) - Firestore rejects undefined array-element values.
export function normalizeRatificationRecords(rows: RatificationRecord[] | undefined): RatificationRecord[] {
  return (rows ?? [])
    .map((r) => ({
      designation: (r.designation ?? "").trim(),
      proceedingsNumber: (r.proceedingsNumber ?? "").trim(),
      date: (r.date ?? "").trim(),
    }))
    .filter((r) => r.designation || r.proceedingsNumber || r.date);
}
