"use client";

import { FacultyTimetableLookup } from "@/components/timetable/FacultyTimetableLookup";

// Thin wrapper - see hod/faculty-timetable and panel/faculty-timetable's own
// copies of this same pattern; all three render FacultyTimetableLookup, the
// actual shared logic (same convention as hod/assignment-requests etc.).
export default function CollegeStaffFacultyTimetablePage() {
  return <FacultyTimetableLookup />;
}
