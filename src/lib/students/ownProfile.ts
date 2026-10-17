import { ROSTER_DETAIL_GROUPS, ROSTER_FIELDS, rosterFieldDisplay, type RosterField } from "./rosterFields";
import type { StudentRecord } from "@/types";

// What a student is shown of THEIR OWN record. Built server-side, as ready-to-
// render label/value rows, so a field that isn't listed here (staff remarks,
// the login linkage - uid, synthetic loginEmail, who issued it - audit stamps,
// graduation snapshot) never reaches the browser at all. Everything that IS
// shown is the student's own value, exactly as the college holds it.

/** Never shown on the student's own page: staff-only notes. */
const HIDDEN_KEYS = new Set(["remarks"]);

const HANDICAPPED_TYPE_LABEL: Record<string, string> = { H: "Hearing", V: "Visual", O: "Other" };

const FIELD_BY_KEY = new Map<string, RosterField>(ROSTER_FIELDS.map((f) => [f.key, f]));

export interface OwnProfileRow {
  label: string;
  value: string;
}

export interface OwnProfileGroup {
  title: string;
  rows: OwnProfileRow[];
}

/** Follow-up details of a Yes/No answer: left out of a full listing when empty (nothing to say about them). */
const FOLLOW_UP_KEYS = new Set([
  "handicappedType", "studiedOutsideAPDetails", "familyIdLinkedOtherStateDetails", "parentsWorkingOutsideDetails",
  "permanentAddressSameAsTemporary",
]);

function rowFor(key: string, student: Partial<StudentRecord>, includeEmpty: boolean): OwnProfileRow | null {
  if (HIDDEN_KEYS.has(key)) return null;
  const field = FIELD_BY_KEY.get(key);
  if (!field) return null;
  let value = rosterFieldDisplay(field, student);
  if (!value) return includeEmpty && !FOLLOW_UP_KEYS.has(key) ? { label: field.label, value: "" } : null;
  if (key === "handicappedType") value = HANDICAPPED_TYPE_LABEL[value] ?? value;
  return { label: field.label, value };
}

/**
 * The roster's detail groups (Academic, Personal, Contact, Family, Bank, ...) for one student. By default
 * empty fields and empty groups are dropped (the student's own page). `includeEmpty` lists every field of every
 * group, a missing one with value "" - what a mentor needs to see what is still not on record.
 */
export function buildOwnProfileGroups(student: Partial<StudentRecord>, options: { includeEmpty?: boolean; /** Roster keys to leave out (already shown elsewhere). */ exclude?: ReadonlySet<string> } = {}): OwnProfileGroup[] {
  const includeEmpty = options.includeEmpty === true;
  return ROSTER_DETAIL_GROUPS.map((g) => ({
    title: g.title,
    rows: g.keys.filter((k) => !options.exclude?.has(k)).map((k) => rowFor(k, student, includeEmpty)).filter((r): r is OwnProfileRow => r !== null),
  })).filter((g) => g.rows.length > 0);
}
