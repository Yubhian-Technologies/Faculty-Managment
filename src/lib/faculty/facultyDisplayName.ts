// A faculty member's canonical display name - used everywhere the app shows
// or refers to them by name (profile pages, lists, PDFs, notifications,
// teaching assignment/section records, login accounts). Full Name (as per
// SSC) is the primary/mandatory identity field; Name (as per PAN) is now
// optional statutory detail, kept only as a fallback for a record that
// happens to have no legalName on file.
export function facultyDisplayName(
  f: { legalName?: string; name?: string } | null | undefined
): string {
  return f?.legalName?.trim() || f?.name?.trim() || "";
}
