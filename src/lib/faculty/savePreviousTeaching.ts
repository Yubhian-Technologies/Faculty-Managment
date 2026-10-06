import type { PreviousTeachingAssignment } from "@/types";
import { previousTeachingProblem } from "@/lib/faculty/previousTeaching";

/**
 * Saves a faculty member's Previous Teaching Assignments from an edit page. `endpoint` is PATCH /api/college/faculty/{id}
 * for the HOD / Principal pages and /api/college/faculty/me for a faculty member's own. Sends the ids the page loaded
 * so a row added meanwhile by someone else is kept (see mergePreviousTeachingAssignments). Returns an error message,
 * or null on success.
 */
export async function savePreviousTeachingAssignments(
  endpoint: string,
  rows: PreviousTeachingAssignment[],
  loadedIds: string[],
): Promise<string | null> {
  const problem = previousTeachingProblem(rows);
  if (problem) return problem;
  try {
    const res = await fetch(endpoint, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ previousTeachingAssignments: rows, previousTeachingAssignmentsLoadedIds: loadedIds }),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return data.error ?? "Failed to save previous teaching assignments";
  } catch {
    return "Network error while saving previous teaching assignments";
  }
}

/** Same rows? Compared by content so an unchanged list is never re-sent. */
export function samePreviousTeaching(a: PreviousTeachingAssignment[], b: PreviousTeachingAssignment[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
