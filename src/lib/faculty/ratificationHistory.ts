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
import { designationKey, designationLabel } from "@/lib/designations/config";
import type { RatificationRecord } from "@/types";

type Doc = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

// The only Ratification Status values the forms offer. "Not Ratified" is the
// older value: it is still read, shown and kept on records that hold it (it is
// never rewritten), it just isn't offered for a new pick any more.
export const RATIFICATION_STATUS_CHOICES = ["Attended", "Ratified"] as const;
export const LEGACY_NOT_RATIFIED = "Not Ratified";

// "Ratified Designation" choices. They come from the college's Designation
// Catalogue (value = the catalogue's own name, so what is stored matches what
// faculty records already hold), narrowed to the teaching cadre - Professor,
// Assistant Professor, Associate Professor - shown by their full names, with
// Principal offered in addition: it is taken from the catalogue when listed
// there (under any category) and otherwise added as plain "Principal", so it
// never goes missing just because it isn't filed under the Faculty category.
const RATIFIED_CHOICE_NAMES = ["Professor", "Assistant Professor", "Associate Professor"];
const PRINCIPAL = "Principal";

export interface RatifiedDesignationChoice { value: string; label: string }

export function ratifiedDesignationChoices(catalogNames: string[]): RatifiedDesignationChoice[] {
  const choices: RatifiedDesignationChoice[] = [];
  for (const name of [...RATIFIED_CHOICE_NAMES, PRINCIPAL]) {
    const key = designationKey(name);
    const inCatalog = catalogNames.find((n) => designationKey(n) === key);
    if (inCatalog) choices.push({ value: inCatalog, label: designationLabel(inCatalog) });
    else if (name === PRINCIPAL) choices.push({ value: name, label: name });
  }
  return choices;
}

// The choice a stored designation stands for - compared the way the catalogue
// does (designationKey), so the legacy code "ASSISTANT_PROFESSOR" and the typed
// "Assistant Professor" resolve to the same one. undefined when it matches none
// (e.g. "Lecturer"): the picker then shows it as it is instead of dropping it.
export function matchRatifiedDesignation(stored: string | undefined | null, choices: RatifiedDesignationChoice[]): string | undefined {
  const key = designationKey(stored);
  if (!key) return undefined;
  return choices.find((o) => designationKey(o.value) === key)?.value;
}

// A blank row, the one shown by default once the status is Ratified.
export const blankRatificationRecord = (): RatificationRecord => ({ designation: "", proceedingsNumber: "", date: "" });

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
