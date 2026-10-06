// A faculty member's canonical display name - used everywhere the app shows
// or refers to them by name (profile pages, lists, PDFs, notifications,
// teaching assignment/section records, login accounts). Full Name (as per
// SSC) - legalName - is the ONLY identity/display name. Name (as per PAN)
// (nameAsPerPan) is an optional statutory detail, independent of legalName
// like nameAsPerAadhar, and is never used as a display fallback.
//
// Prefixed with the admin-curated Honorific (colleges/{id}/honorifics - see
// HonorificsCatalogCard), when the record has one set, so every one of this
// function's 60+ callers picks it up for free instead of each needing its
// own "Dr." concatenation. Never applied to a blank name - an honorific
// with nothing to prefix is meaningless.
//
// Formatted as "Honorific.Name" - a single period, no space - regardless of
// whether the admin typed the catalog entry with a trailing period of its
// own ("Dr." and "Dr" both render identically, never "Dr..").
export function facultyDisplayName(
  f: { legalName?: string; honorific?: string } | null | undefined
): string {
  const name = f?.legalName?.trim() || "";
  if (!name) return "";
  const honorific = f?.honorific?.trim().replace(/\.+$/, "");
  return honorific ? `${honorific}.${name}` : name;
}
