"use client";

import { useParams } from "next/navigation";
import { TeachingAssignmentsEditor } from "@/components/timetable/TeachingAssignmentsEditor";

// Thin wrapper - see panel/timetable-incharge/[courseId]/[year]/
// teaching-assignments and college-staff/timetable-incharge/[courseId]/
// [year]/teaching-assignments' own copies of this same pattern; all three
// render TeachingAssignmentsEditor, the actual shared logic. Reached from the
// "Teaching Assignments" button on hod/timetable/[courseId]/[year]/page.tsx -
// a course-year-scoped shortcut alongside the section grid, distinct from
// the full department-wide picker at hod/teaching-assignments/page.tsx.
export default function HODTeachingAssignmentsPage() {
  const { courseId, year } = useParams<{ courseId: string; year: string }>();
  return (
    <TeachingAssignmentsEditor
      courseId={courseId}
      year={year}
      backHref={`/hod/timetable/${courseId}/${year}`}
    />
  );
}
