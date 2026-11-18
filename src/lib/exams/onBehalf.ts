import type { MidEntryState } from "@/lib/exams/midMarksEntry";

// The College Admin entering a faculty member's internal marks on their behalf (a stalled section): the same sheet
// and rules as the faculty, except that a Mid not yet opened for faculty is open to the admin. A Mid the Exam Cell
// uploads stays the Exam Cell's, and a Mid without its questions (no finalized paper / Exam Cell layout) can't be
// entered question-wise by anyone yet.
export function onBehalfState(s: MidEntryState, hasSheet: boolean): MidEntryState {
  if (s.mode === "EXAM_CELL") return s;
  if (!hasSheet) return { ...s, facultyCanEdit: false, note: "Its questions aren't set yet - the Exam Cell finalizes the paper or sets the questions first." };
  return { ...s, facultyCanEdit: true, note: undefined };
}

export const isCollegeAdminSession = (s: { realRole?: string }) => s.realRole === "COLLEGE_ADMIN";
