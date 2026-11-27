// Mid marks progress (lib/exams/midMarksEntryServer.ts midProgress): a section taught by two faculty has two
// teaching rows, but its Mid marks live on ONE sheet (the Exam Cell upload and the faculty page both use the first
// assignment). When one row of a section has marks started, the other faculty's empty row of that same section is
// left out - otherwise the section shows "Not Started" forever and the Remind button nags someone with nothing to do.

export interface ProgressRowLike { sectionId: string; status: "NOT_STARTED" | "DRAFT" | "SUBMITTED" | "FROZEN"; entered: number; sheetId?: string }

export function dropCoveredSections<T extends ProgressRowLike>(rows: T[]): T[] {
  const started = new Set(rows.filter((r) => r.status !== "NOT_STARTED" || r.entered > 0 || r.sheetId).map((r) => r.sectionId));
  return rows.filter((r) => !(started.has(r.sectionId) && r.status === "NOT_STARTED" && r.entered === 0 && !r.sheetId));
}
