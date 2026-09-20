// A faculty member's canonical display name - used everywhere the app shows
// or refers to them by name (profile pages, lists, PDFs, notifications,
// teaching assignment/section records, login accounts). Full Name (as per
// SSC) - legalName - is the ONLY identity/display name. Name (as per PAN)
// (nameAsPerPan) is an optional statutory detail, independent of legalName
// like nameAsPerAadhar, and is never used as a display fallback.
export function facultyDisplayName(
  f: { legalName?: string } | null | undefined
): string {
  return f?.legalName?.trim() || "";
}
