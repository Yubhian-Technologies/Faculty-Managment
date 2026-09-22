// Which parts of a resume to render. The CSV export picks individual fields
// (see lib/faculty/csvColumns.ts); a resume is composed of whole sections
// instead - each one is a heading plus its own entries, and half a section
// reads as a mistake rather than a choice. So this is the unit the download
// dialog offers.
//
// The keys and their order match renderSection() calls in resumeTemplate.ts.
export const RESUME_SECTIONS = [
  { key: "personal", label: "Personal & Contact Details" },
  { key: "education", label: "Education" },
  { key: "experience", label: "Previous Experience" },
  { key: "teachingLoad", label: "Teaching Load" },
  { key: "research", label: "Research & Innovation" },
  { key: "mentorship", label: "Mentorship & Institutional Contribution" },
  { key: "otherInfo", label: "Other Information" },
  { key: "financial", label: "Financial Standing" },
] as const;

export type ResumeSectionKey = (typeof RESUME_SECTIONS)[number]["key"];

export const RESUME_SECTION_KEYS: ResumeSectionKey[] = RESUME_SECTIONS.map((s) => s.key);

// Everything except Financial Standing, which carries salary and CTC - fine
// for an internal record, rarely wanted in a resume handed to anyone else.
// A deliberate default, not a cap: it is one tick away in the dialog.
export const DEFAULT_RESUME_SECTIONS: ResumeSectionKey[] = RESUME_SECTION_KEYS.filter(
  (k) => k !== "financial"
);

/**
 * Whether `key` should be rendered, given what the caller asked for.
 *
 * An ABSENT list means every section - so a caller that knows nothing about
 * this (the Super Admin user list, the PDF route called directly) keeps
 * producing the complete resume it always did. Only a caller that actually
 * passes a list gets a filtered one, and an empty list is honoured as "none"
 * rather than quietly treated as "all".
 */
export function isResumeSectionEnabled(
  selected: readonly string[] | undefined,
  key: ResumeSectionKey
): boolean {
  if (!selected) return true;
  return selected.includes(key);
}
