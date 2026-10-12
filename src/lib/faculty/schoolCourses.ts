// Intermediate / Diploma / ITI course names the code reasons about (the stored `course` value is the plain text below).

export const DIPLOMA_COURSE = "Diploma";
export const DIPLOMA_PHARMACY_COURSE = "Diploma in Pharmacy";

/** Diploma and Diploma in Pharmacy both ask for a Branch (stored in the existing `branch` key). */
export function isDiplomaCourse(course: string | undefined | null): boolean {
  return course === DIPLOMA_COURSE || course === DIPLOMA_PHARMACY_COURSE;
}

/** Hint inside the Branch box: D.Pharm for Diploma in Pharmacy, the usual engineering branches otherwise. */
export function diplomaBranchPlaceholder(course: string | undefined | null): string {
  return course === DIPLOMA_PHARMACY_COURSE ? "D.Pharm" : "e.g. CIV, EEE, MEC";
}
