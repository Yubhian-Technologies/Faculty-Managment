"use client";

import { CalendarSearch } from "lucide-react";
import { FacultyTimetableLookup } from "@/components/timetable/FacultyTimetableLookup";
import { EmptyState } from "@/components/shared/EmptyState";
import { useMyAssignments } from "@/hooks/useMyAssignments";

// Thin wrapper - see hod/faculty-timetable and panel/faculty-timetable's own
// copies of this same pattern; all three render FacultyTimetableLookup, the
// actual shared logic (same convention as hod/assignment-requests etc.).
//
// Only a supporting-staff login that holds a Timetable Incharge delegation may
// use it (the sidebar link is hidden otherwise - see useNavVisibility - and
// api/college/faculty-schedule enforces the same rule). This check just gives
// someone who typed the URL a clear message instead of a failed lookup.
export default function CollegeStaffFacultyTimetablePage() {
  const assignments = useMyAssignments(true);
  if (assignments === null) return null; // not known yet
  if (!assignments.timetableIncharge) {
    return (
      <EmptyState
        icon={<CalendarSearch className="h-6 w-6" />}
        title="Faculty Timetable is for Timetable Incharges"
        description="This page is available once your HOD assigns you as Timetable Incharge for a course and year."
      />
    );
  }
  return <FacultyTimetableLookup />;
}
