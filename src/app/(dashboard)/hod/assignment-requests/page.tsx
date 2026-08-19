"use client";

import { AssignmentRequestsPanel } from "@/components/timetable/AssignmentRequestsPanel";

// Thin wrapper - see panel/assignment-requests and college-staff/
// assignment-requests' own copies of this same pattern; all three render
// AssignmentRequestsPanel, the actual shared logic.
export default function AssignmentRequestsPage() {
  return (
    <AssignmentRequestsPanel
      timetableHrefFor={(r) =>
        `/hod/timetable/${r.courseId}/${r.year}/${r.sectionId}?courseName=${encodeURIComponent(r.courseName)}&sectionName=${encodeURIComponent(r.sectionName)}&requestId=${r.id}&assignmentId=${r.teachingAssignmentId ?? ""}`
      }
    />
  );
}
