// A supporting/non-technical staff member's canonical display name - used
// everywhere the app shows or refers to them by name (profile pages, lists,
// login accounts, timetable in-charge pickers, leave rosters). Full Name (as
// per SSC) is the primary identity field; Name (as per PAN) is optional
// statutory detail, kept only as a fallback for a record that happens to have
// no legalName on file. Mirrors src/lib/faculty/facultyDisplayName.ts.
export function supportingStaffDisplayName(
  s: { legalName?: string; name?: string } | null | undefined
): string {
  return s?.legalName?.trim() || s?.name?.trim() || "";
}
