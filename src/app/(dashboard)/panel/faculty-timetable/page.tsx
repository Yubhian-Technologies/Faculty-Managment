"use client";

import { FacultyTimetableLookup } from "@/components/timetable/FacultyTimetableLookup";

// A panel member is a faculty member - show their own timetable directly, no
// department/faculty filters (those stay on the HOD and college-staff copies).
export default function PanelFacultyTimetablePage() {
  return <FacultyTimetableLookup ownOnly />;
}
