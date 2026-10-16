// What makes a master subject "the same subject": inside one Course Catalog
// course + regulation, a Subject Code names exactly one subject and a Subject
// Name names exactly one subject. The Exam Cell matches university results to
// subjects by code, so a second subject with the same code (or one renamed
// under an old code) would attach grades to the wrong subject.

/** Codes are stored trimmed and upper-cased. */
export function normalizeSubjectCode(code: unknown): string {
  return String(code ?? "").trim().toUpperCase();
}

/** Names are compared trimmed, case-folded and with runs of whitespace collapsed. */
export function normalizeSubjectName(name: unknown): string {
  return String(name ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
}
