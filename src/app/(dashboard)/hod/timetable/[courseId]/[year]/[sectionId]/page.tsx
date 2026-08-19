"use client";

import { useParams } from "next/navigation";
import { TimetableGridEditor } from "@/components/timetable/TimetableGridEditor";

// Thin wrapper - all the actual logic lives in TimetableGridEditor, shared
// with panel/timetable-incharge/[courseId]/[year]/[sectionId]/page.tsx (the
// HOD's delegated Timetable Incharge's own equivalent - see TimetableIncharge
// in src/types/core.ts).
export default function HODTimetableGridPage() {
  const { courseId, year, sectionId } = useParams<{ courseId: string; year: string; sectionId: string }>();
  return (
    <TimetableGridEditor
      courseId={courseId}
      year={year}
      sectionId={sectionId}
      backHref={`/hod/timetable/${courseId}/${year}`}
    />
  );
}
