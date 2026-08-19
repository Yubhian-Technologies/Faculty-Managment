"use client";

import { useParams } from "next/navigation";
import { TimetableGridEditor } from "@/components/timetable/TimetableGridEditor";

// Thin wrapper - see hod/timetable/[courseId]/[year]/[sectionId]/page.tsx and
// panel/timetable-incharge/[courseId]/[year]/[sectionId]/page.tsx's own
// copies of this same pattern; all three render TimetableGridEditor, the
// actual shared logic, for whichever of an HOD or their delegated Timetable
// Incharge (teaching faculty or Technical supporting staff) is visiting.
export default function TimetableInchargeGridPage() {
  const { courseId, year, sectionId } = useParams<{ courseId: string; year: string; sectionId: string }>();
  return (
    <TimetableGridEditor
      courseId={courseId}
      year={year}
      sectionId={sectionId}
      backHref={`/college-staff/timetable-incharge/${courseId}/${year}`}
    />
  );
}
