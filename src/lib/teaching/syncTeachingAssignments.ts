import type { StagedTeachingRow } from "@/components/faculty/TeachingAssignmentsEditor";

async function parseError(res: Response): Promise<string> {
  try {
    const json = await res.json() as { error?: string };
    return json.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

// Diffs `originalRows` (as loaded from the server) against `currentRows` (as edited in
// TeachingAssignmentsEditor) and persists the difference via the teaching-assignments /
// timetable-slots APIs. Returns any error messages encountered (partial failures do not
// throw - the caller decides how to surface them).
export async function syncTeachingAssignments(
  facultyId: string,
  facultyName: string,
  originalRows: StagedTeachingRow[],
  currentRows: StagedTeachingRow[],
): Promise<string[]> {
  const errors: string[] = [];

  // A row counts as removed if it's gone entirely, or if it's still present but was cleared
  // back to "None" (courseId/sectionId/subjectId emptied) - both cases must delete the
  // existing assignment server-side, not just leave it stale.
  const removedRows = originalRows.filter((o) => {
    if (!o.id) return false;
    const current = currentRows.find((c) => c.id === o.id);
    return !current || !current.courseId || !current.sectionId || !current.subjectId;
  });
  for (const row of removedRows) {
    const res = await fetch(`/api/college/teaching-assignments/${row.id}`, { method: "DELETE" });
    if (!res.ok) errors.push(`Removing ${row.subjectName}: ${await parseError(res)}`);
  }

  for (const row of currentRows) {
    if (!row.courseId || !row.sectionId || !row.subjectId) continue;

    if (!row.id) {
      const res = await fetch("/api/college/teaching-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId,
          facultyName,
          courseId: row.courseId,
          sectionId: row.sectionId,
          subjectId: row.subjectId,
          hoursPerWeek: row.hoursPerWeek,
          slots: row.slots.map((s) => ({ day: s.day, periodNumber: s.periodNumber, ...(s.allowSplit ? { allowSplit: true } : {}) })),
          assignmentAcademicYear: row.assignmentAcademicYear ?? "",
          assignmentSemester: row.assignmentSemester ?? "",
          ...(row.isPast ? {
            isPast: true,
            ...(row.passPercentage != null ? { passPercentage: row.passPercentage } : {}),
            ...(row.studentFeedback != null ? { studentFeedback: row.studentFeedback } : {}),
          } : {}),
        }),
      });
      if (!res.ok) errors.push(`Adding ${row.subjectName}: ${await parseError(res)}`);
      continue;
    }

    const original = originalRows.find((o) => o.id === row.id);

    if (row.isPast) {
      // Past rows have no weekly schedule to diff - just persist the record's
      // fields (academic year/semester/hours/pass %) if they've changed.
      if (
        original?.assignmentAcademicYear !== row.assignmentAcademicYear ||
        original?.assignmentSemester !== row.assignmentSemester ||
        original?.passPercentage !== row.passPercentage ||
        original?.studentFeedback !== row.studentFeedback ||
        original?.hoursPerWeek !== row.hoursPerWeek
      ) {
        const res = await fetch(`/api/college/teaching-assignments/${row.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            hoursPerWeek: row.hoursPerWeek,
            assignmentAcademicYear: row.assignmentAcademicYear ?? "",
            assignmentSemester: row.assignmentSemester ?? "",
            passPercentage: row.passPercentage ?? null,
            studentFeedback: row.studentFeedback ?? null,
          }),
        });
        if (!res.ok) errors.push(`Updating past record for ${row.subjectName}: ${await parseError(res)}`);
      }
      continue;
    }

    // Current (non-past) rows: academic year/semester can still change even
    // though there's no pass % - persist those independently of the slot diffing below.
    if (original?.assignmentAcademicYear !== row.assignmentAcademicYear || original?.assignmentSemester !== row.assignmentSemester) {
      const res = await fetch(`/api/college/teaching-assignments/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentAcademicYear: row.assignmentAcademicYear ?? "",
          assignmentSemester: row.assignmentSemester ?? "",
        }),
      });
      if (!res.ok) errors.push(`Updating academic year/semester for ${row.subjectName}: ${await parseError(res)}`);
    }

    const originalSlots = original?.slots ?? [];
    const removedSlots = originalSlots.filter((o) => o.id && !row.slots.some((s) => s.id === o.id));
    for (const slot of removedSlots) {
      const res = await fetch(`/api/college/timetable-slots/${slot.id}`, { method: "DELETE" });
      if (!res.ok) errors.push(`Removing a schedule slot for ${row.subjectName}: ${await parseError(res)}`);
    }

    const addedSlots = row.slots.filter((s) => !s.id);
    for (const slot of addedSlots) {
      const res = await fetch("/api/college/timetable-slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: row.id, day: slot.day, periodNumber: slot.periodNumber,
          ...(slot.allowSplit ? { allowSplit: true } : {}),
        }),
      });
      if (!res.ok) errors.push(`Scheduling ${row.subjectName} on ${slot.day} period ${slot.periodNumber}: ${await parseError(res)}`);
    }
  }

  return errors;
}
