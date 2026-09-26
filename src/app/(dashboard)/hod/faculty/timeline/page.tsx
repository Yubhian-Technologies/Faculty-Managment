"use client";

import { FacultyTimelineView } from "@/components/faculty/FacultyTimelineView";

// Faculty Register's "Faculty Timeline" tab - deliberately its own tab/route,
// not a control bolted onto the main register. See FacultyTimelineView for
// the shared filter/select/export UI (also used by Principal's per-department
// timeline), and facultyTimeline.ts for the underlying filter logic.
export default function FacultyTimelinePage() {
  return (
    <FacultyTimelineView
      fetchUrl="/api/college/faculty"
      backHref="/hod/faculty"
      rowHref={(row) => `/hod/faculty/${row.id}`}
    />
  );
}
