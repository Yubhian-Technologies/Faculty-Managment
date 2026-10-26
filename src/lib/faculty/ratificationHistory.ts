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

// Ratification is a two-step choice in the forms, kept in the existing
// `ratificationStatus` field, so no stored record needs rewriting:
//   Ratification Status    : Attended | Not Yet Attended
//   Ratification Decision  : Ratified | Not Ratified   (only once Attended)
// Stored value, by what the faculty member picked:
//   "Not Yet Attended"  -> Status = Not Yet Attended
//   "Attended"          -> Status = Attended, Decision not chosen yet
//   "Ratified"          -> Status = Attended, Decision = Ratified
//   "Not Ratified" + `ratificationAttended: true` -> Status = Attended, Decision = Not Ratified
// "Ratified" and "Not Ratified" are the two values every record already on file
// holds (VIT, VWU). A "Not Ratified" record WITHOUT the `ratificationAttended`
// marker is one of those older records: nobody has said whether they attended, so
// it is shown exactly as before - "Not Ratified" in the Status box, no Decision -
// and is only changed when the person picks Attended / Not Yet Attended. The
// marker is written only when the Decision "Not Ratified" is picked (see
// ratificationStatusPatch); no existing record gets it. Any other stored text
// (e.g. a stray "Not Applicable") is likewise shown as it is.
export const RATIFICATION_STATUS_CHOICES = ["Attended", "Not Yet Attended"] as const;
export const RATIFICATION_RESULT_CHOICES = ["Ratified", "Not Ratified"] as const;
export const RATIFICATION_STATUS_STORED = ["Not Yet Attended", "Attended", "Not Ratified", "Ratified"] as const;

export const isRatified = (status: string | undefined | null): boolean => status === "Ratified";

// A stored "Not Ratified" the person has confirmed as Attended + Decision Not Ratified.
const isDecidedNotRatified = (status: string | undefined | null, attended: boolean | undefined | null): boolean =>
  status === "Not Ratified" && attended === true;

// Step 1's value for a stored status: "Not Yet Attended" / "Attended", or the
// stored text itself when it is an older value (the picker lists it as-is).
export function ratificationStatusStep(status: string | undefined | null, attended?: boolean | null): string {
  const v = status ?? "";
  if (v === "Attended" || v === "Ratified" || isDecidedNotRatified(v, attended)) return "Attended";
  return v;
}

// Step 2's value: only meaningful once Attended ("" = not chosen yet).
export function ratificationResultStep(status: string | undefined | null, attended?: boolean | null): string {
  return status === "Ratified" || isDecidedNotRatified(status, attended) ? (status as string) : "";
}

// True for a stored status the two-step picker does not offer as such: an older
// "Not Ratified" (no marker) or any other text.
export const isLegacyRatificationStatus = (status: string | undefined | null, attended?: boolean | null): boolean =>
  !!status && (!(RATIFICATION_STATUS_STORED as readonly string[]).includes(status) || (status === "Not Ratified" && attended !== true));

// The form-state change for picking `pick` in the Ratification Status dropdown
// (level "status") or the Ratification Decision dropdown (level "result").
// - Picking Attended again keeps a Decision already chosen; otherwise the stored
//   value is "Attended" until a Decision is picked.
// - `ratificationAttended` is set only by picking the Decision "Not Ratified", and
//   switched off again only if it was on and the value moves to something else.
//   It is left untouched (not sent) in every other case, so untouched records never gain it.
// - Without the faculty history list (Staff / user records) the single
//   Proceedings Number/Date pair is cleared once the value is not Ratified, so a
//   later Save cannot resend a stale one. WITH the history list nothing is
//   cleared: its rows are only hidden while not Ratified and are still there if
//   Ratified is picked again - nothing already on file is deleted by a pick.
export function ratificationStatusPatch(
  current: string | undefined | null,
  attended: boolean | undefined | null,
  pick: string,
  level: "status" | "result",
  history: boolean,
): { ratificationStatus: string; ratificationAttended?: boolean; ratificationProceedingsNumber?: string; ratificationDate?: string } {
  const next = level === "status" && pick === "Attended" ? (ratificationResultStep(current, attended) || "Attended") : pick;
  const marker: { ratificationAttended?: boolean } =
    level === "result" && pick === "Not Ratified" ? { ratificationAttended: true }
    : next === "Not Ratified" && isDecidedNotRatified(current, attended) ? {}
    : attended === true ? { ratificationAttended: false }
    : {};
  return !history && next !== "Ratified"
    ? { ratificationStatus: next, ...marker, ratificationProceedingsNumber: "", ratificationDate: "" }
    : { ratificationStatus: next, ...marker };
}

// What the view shows as Status / Decision for a stored value (Decision is omitted
// until one is chosen; an older value is shown as the Status as it is).
export function ratificationDisplay(status: string | undefined | null, attended?: boolean | null): { status?: string; result?: string } {
  if (!status) return {};
  if (status === "Ratified" || isDecidedNotRatified(status, attended)) return { status: "Attended", result: status };
  return { status };
}

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
