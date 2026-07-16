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
// throw — the caller decides how to surface them).
export async function syncTeachingAssignments(
  facultyId: string,
  facultyName: string,
  originalRows: StagedTeachingRow[],
  currentRows: StagedTeachingRow[],
): Promise<string[]> {
  const errors: string[] = [];

  const removedRows = originalRows.filter((o) => o.id && !currentRows.some((c) => c.id === o.id));
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
          slots: row.slots.map((s) => ({ day: s.day, periodNumber: s.periodNumber })),
        }),
      });
      if (!res.ok) errors.push(`Adding ${row.subjectName}: ${await parseError(res)}`);
      continue;
    }

    const original = originalRows.find((o) => o.id === row.id);
    if (original && original.hoursPerWeek !== row.hoursPerWeek) {
      const res = await fetch(`/api/college/teaching-assignments/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hoursPerWeek: row.hoursPerWeek }),
      });
      if (!res.ok) errors.push(`Updating ${row.subjectName} hours: ${await parseError(res)}`);
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
        body: JSON.stringify({ assignmentId: row.id, day: slot.day, periodNumber: slot.periodNumber }),
      });
      if (!res.ok) errors.push(`Scheduling ${row.subjectName} on ${slot.day} period ${slot.periodNumber}: ${await parseError(res)}`);
    }
  }

  return errors;
}
