"use client";

import { useParams } from "next/navigation";
import { TimetableGridEditor } from "@/components/timetable/TimetableGridEditor";

// Thin wrapper - see hod/timetable/[courseId]/[year]/[sectionId]/page.tsx's
// own copy of this same pattern; both render TimetableGridEditor, the actual
// shared logic, for whichever of an HOD or their delegated Timetable
// Incharge is visiting (see TimetableIncharge in src/types/core.ts).
export default function TimetableInchargeGridPage() {
  const { courseId, year, sectionId } = useParams<{ courseId: string; year: string; sectionId: string }>();
  return (
    <TimetableGridEditor
      courseId={courseId}
      year={year}
      sectionId={sectionId}
      backHref={`/panel/timetable-incharge/${courseId}/${year}`}
    />
  );
}
