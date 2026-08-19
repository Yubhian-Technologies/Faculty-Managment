"use client";

import { useParams } from "next/navigation";
import { TeachingAssignmentsEditor } from "@/components/timetable/TeachingAssignmentsEditor";

// Thin wrapper - see hod/timetable/[courseId]/[year]/teaching-assignments and
// panel/timetable-incharge/[courseId]/[year]/teaching-assignments' own
// copies of this same pattern; all three render TeachingAssignmentsEditor,
// the actual shared logic.
export default function TimetableInchargeAssignmentsPage() {
  const { courseId, year } = useParams<{ courseId: string; year: string }>();
  return (
    <TeachingAssignmentsEditor
      courseId={courseId}
      year={year}
      backHref="/college-staff/timetable-incharge"
    />
  );
}
