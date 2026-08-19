"use client";

import { AssignmentRequestsPanel } from "@/components/timetable/AssignmentRequestsPanel";

// Thin wrapper - see hod/assignment-requests and panel/assignment-requests'
// own copies of this same pattern; all three render AssignmentRequestsPanel,
// the actual shared logic. Reachable by a Timetable Incharge (see
// TimetableIncharge in src/types/core.ts) for any department they're
// delegated in, not just their own course-year - fulfilling an incoming
// request isn't tied to one course-year (see isTimetableInchargeForDepartment).
export default function AssignmentRequestsPage() {
  return (
    <AssignmentRequestsPanel
      timetableHrefFor={(r) =>
        `/college-staff/timetable-incharge/${r.courseId}/${r.year}/${r.sectionId}?courseName=${encodeURIComponent(r.courseName)}&sectionName=${encodeURIComponent(r.sectionName)}&requestId=${r.id}&assignmentId=${r.teachingAssignmentId ?? ""}`
      }
    />
  );
}
