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
  const raw = f?.honorific?.trim().replace(/\.+$/, "");
  // Shown as "Mrs" / "Mr" / "Dr", whatever case it was typed or stored in.
  const honorific = raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : "";
  return honorific ? `${honorific}.${name}` : name;
}

// A name already saved with its title baked in ("MRS.ANITHA", "DR. RAVI" - the
// login's mirrored `name`) shown with that title as "Mrs" / "Dr": first capital,
// then small letters. Only a leading, well-known title is touched.
const LEADING_TITLE = /^(mrs|mr|ms|miss|dr|prof|smt|sri|shri)(?=[.\s])/i;
export function normalizeNameTitle(name: string): string {
  return name.replace(LEADING_TITLE, (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());
}
