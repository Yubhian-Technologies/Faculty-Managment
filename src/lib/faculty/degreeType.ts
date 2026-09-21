// UG/PG "Degree" field: when Course is "B.Tech/BE" or "M.Tech/ME" the qualification must
// also say which of the two it is. Stored as DegreeDetail.degreeType on every UG/PG entry
// (ugDetails, additionalUgDetails, pgDetails, additionalPgDetails); absent for any
// other course.

import type { DegreeDetail, DegreeType } from "@/types";

export const BTECH_BE_COURSE = "B.Tech/BE";
export const MTECH_ME_COURSE = "M.Tech/ME";

// Courses that ask for a Degree, and the choices each offers.
export const DEGREE_TYPE_OPTIONS_BY_COURSE: Record<string, readonly DegreeType[]> = {
  [BTECH_BE_COURSE]: ["B.Tech", "BE"],
  [MTECH_ME_COURSE]: ["M.Tech", "ME"],
};

export function degreeTypeOptions(course: string | undefined | null): readonly DegreeType[] {
  return (course && DEGREE_TYPE_OPTIONS_BY_COURSE[course]) || [];
}

export function isValidDegreeType(course: string | undefined | null, v: unknown): v is DegreeType {
  return typeof v === "string" && (degreeTypeOptions(course) as readonly string[]).includes(v);
}

export function needsDegreeType(d: Pick<DegreeDetail, "course"> | undefined | null): boolean {
  return degreeTypeOptions(d?.course).length > 0;
}

// Every UG/PG entry of an academicProfile (or of a partial set of its keys, as the
// section-scoped saves send) paired with the label the UI shows for it.
const UG_PG_SLOTS: { key: string; label: string; list: boolean }[] = [
  { key: "ugDetails", label: "UG Details", list: false },
  { key: "additionalUgDetails", label: "UG Details", list: true },
  { key: "pgDetails", label: "PG Details", list: false },
  { key: "additionalPgDetails", label: "PG Details", list: true },
];

// Returns a human-readable problem for the first UG/PG entry that has Course =
// B.Tech/BE without a valid Degree (or carries an unrecognised Degree), or null.
// Keys not present in `profile` are skipped, so a partial payload only checks
// what it is actually writing.
export function degreeTypeError(profile: unknown): string | null {
  if (typeof profile !== "object" || profile === null) return null;
  const p = profile as Record<string, unknown>;
  for (const { key, label, list } of UG_PG_SLOTS) {
    const raw = p[key];
    const entries = list ? (Array.isArray(raw) ? raw : []) : raw ? [raw] : [];
    for (let i = 0; i < entries.length; i++) {
      const d = entries[i] as Partial<DegreeDetail> | null;
      if (!d || typeof d !== "object") continue;
      const name = list ? `${label} ${i + 2}` : label;
      const options = degreeTypeOptions(d.course);
      if (options.length > 0) {
        if (!isValidDegreeType(d.course, d.degreeType)) {
          return `${name}: Degree (${options.join(" or ")}) is required when Course is ${d.course}`;
        }
      } else if (d.degreeType !== undefined && d.degreeType !== null && (d.degreeType as string) !== "") {
        return `${name}: Degree is only applicable when Course is ${BTECH_BE_COURSE} or ${MTECH_ME_COURSE}`;
      }
    }
  }
  return null;
}
