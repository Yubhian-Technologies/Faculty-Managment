import type { Course } from "@/types";

// Collapses duplicate `courses` docs that represent the SAME conceptual
// course within the SAME department - e.g. a course doc created before the
// Course Catalog feature existed (free-typed name/code, no catalogId)
// sitting alongside a properly catalog-linked doc for the same programme.
// Nothing in the write path (POST/PATCH /api/college/courses) can detect
// this case - its duplicate guard is keyed on (departmentId, catalogId), so a
// catalogId: undefined doc is invisible to it (see
// scripts/fix-course-catalog-duplicates.mjs, which documents and offline-
// reconciles the same root cause). This is the read-side counterpart: it
// doesn't touch Firestore, so it degrades gracefully however the underlying
// data drifts, without needing a one-off migration to stay correct.
//
// Deliberately scoped to ONE department at a time - two Course docs with the
// same name in DIFFERENT departments (e.g. a feeder department's own
// first-year course cross-listed into a fed department via
// getRelatedDepartmentIds) are legitimate, distinct data, not a duplicate -
// see principal/attendance-history/[departmentId]/page.tsx, which
// deliberately shows and annotates that case rather than hiding it.

function normalizeCourseName(name: string): string {
  return (name ?? "")
    .trim()
    .toLowerCase()
    .replace(/s\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface CourseGroup {
  // The single doc chosen to represent the group in a picker - prefers a
  // catalog-linked doc (the modern, actively-maintained record) over a
  // legacy one, then the most recently created.
  primary: Course & { id: string };
  // Every doc id in the group, including primary.id - use this (not just
  // primary.id) when filtering another collection by courseId, so data
  // attached to the non-primary duplicate isn't silently missed.
  memberIds: string[];
}

export function groupCoursesByIdentity(courses: (Course & { id: string })[]): CourseGroup[] {
  const groups = new Map<string, (Course & { id: string })[]>();
  for (const c of courses) {
    const key = `${c.departmentId}::${normalizeCourseName(c.name)}`;
    const list = groups.get(key);
    if (list) list.push(c);
    else groups.set(key, [c]);
  }

  return Array.from(groups.values()).map((members) => {
    const sorted = [...members].sort((a, b) => {
      const aLinked = a.catalogId ? 1 : 0;
      const bLinked = b.catalogId ? 1 : 0;
      if (aLinked !== bLinked) return bLinked - aLinked;
      const aTime = a.createdAt?.toMillis?.() ?? 0;
      const bTime = b.createdAt?.toMillis?.() ?? 0;
      return bTime - aTime;
    });
    return { primary: sorted[0], memberIds: members.map((m) => m.id) };
  });
}

// Convenience for a caller that already knows which single courseId a user
// picked and just needs the full duplicate-group id set to widen a query by
// (e.g. teachingAssignments.where("courseId", "in", ...)). Falls back to
// `[courseId]` alone when no grouping is found (course not in the list, or
// grouping produced a singleton) - never narrower than what was asked for.
export function resolveMergedCourseIds(courses: (Course & { id: string })[], courseId: string): string[] {
  const groups = groupCoursesByIdentity(courses);
  const group = groups.find((g) => g.memberIds.includes(courseId));
  return group ? group.memberIds : [courseId];
}
