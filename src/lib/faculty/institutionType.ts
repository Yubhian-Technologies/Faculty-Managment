// Academic Details (UG / PG / Ph.D. / Postdoctoral): the "Institution Type" picker and the optional detail that follows it.
//
// Storage is additive. `institutionType` keeps its stored values ("INSTITUTE" | "UNIVERSITY") - only the label of
// "INSTITUTE" changed, to "Affiliated College" - so the ~630 entries already saved are read exactly as before. The keys
// below are new, optional, and absent on every older record (which simply shows nothing for them).

import type { DegreeDetail } from "@/types";

export const INSTITUTION_TYPE_OPTIONS: { value: NonNullable<DegreeDetail["institutionType"]>; label: string }[] = [
  { value: "INSTITUTE", label: "Affiliated College" },
  { value: "UNIVERSITY", label: "University" },
];

export function institutionTypeLabel(v: DegreeDetail["institutionType"] | undefined | null): string | undefined {
  return INSTITUTION_TYPE_OPTIONS.find((o) => o.value === v)?.label;
}

// The Institution Name box is a label change only (the stored key stays `institutionName`): "University/Institution Name"
// once University is picked, "Institution Name" otherwise (Affiliated College, nothing picked, or an older record).
export function institutionNameLabel(type: DegreeDetail["institutionType"] | undefined | null): string {
  return type === "UNIVERSITY" ? "University/Institution Name" : "Institution Name";
}

export const COLLEGE_TYPE_OPTIONS: { value: NonNullable<DegreeDetail["collegeType"]>; label: string }[] = [
  { value: "AUTONOMOUS", label: "Autonomous College" },
  { value: "NON_AUTONOMOUS", label: "Non-Autonomous College" },
];

export const UNIVERSITY_TYPE_OPTIONS: { value: NonNullable<DegreeDetail["universityType"]>; label: string }[] = [
  { value: "STATE", label: "State University" },
  { value: "DEEMED", label: "Deemed to be University" },
  { value: "IIT", label: "IIT" },
  { value: "NIT", label: "NIT" },
  { value: "IIIT", label: "IIIT" },
  { value: "OTHERS", label: "Others" },
];

export function collegeTypeLabel(v: DegreeDetail["collegeType"] | undefined | null): string | undefined {
  return COLLEGE_TYPE_OPTIONS.find((o) => o.value === v)?.label;
}

// "Others" shows what the person typed; the other choices show their label.
export function universityTypeLabel(d: Pick<DegreeDetail, "universityType" | "universityTypeOther"> | undefined | null): string | undefined {
  if (!d?.universityType) return undefined;
  if (d.universityType === "OTHERS") return d.universityTypeOther?.trim() || "Others";
  return UNIVERSITY_TYPE_OPTIONS.find((o) => o.value === d.universityType)?.label;
}

// Picking the institution type clears only the NEW detail keys that belong to the other type (so a College Type never
// lingers under a University). Nothing that was already stored - institutionName, affiliatedUniversity - is touched.
// Keys are removed, never set to undefined: Firestore rejects undefined field values.
export function withInstitutionType(v: DegreeDetail, type: DegreeDetail["institutionType"]): DegreeDetail {
  if (v.institutionType === type) return v;
  const { collegeType, universityType, universityTypeOther, ...rest } = v;
  void collegeType; void universityType; void universityTypeOther;
  return { ...rest, institutionType: type };
}

// Picking University Type: the free-text box belongs only to "Others".
export function withUniversityType(v: DegreeDetail, type: NonNullable<DegreeDetail["universityType"]>): DegreeDetail {
  const { universityTypeOther, ...rest } = v;
  return { ...(type === "OTHERS" && universityTypeOther !== undefined ? { ...rest, universityTypeOther } : rest), universityType: type };
}
