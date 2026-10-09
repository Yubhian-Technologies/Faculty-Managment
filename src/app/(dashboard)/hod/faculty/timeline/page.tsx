"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { FacultyTimelineView } from "@/components/faculty/FacultyTimelineView";
import { resolveListBack, withListBack } from "@/lib/listReturn";

function FacultyTimelineContent() {
  // Back (and a profile's Back) return to the register as it was opened from.
  const listHref = resolveListBack(useSearchParams(), "/hod/faculty");
  return (
    <FacultyTimelineView
      fetchUrl="/api/college/faculty"
      backHref={listHref}
      rowHref={(row) => withListBack(`/hod/faculty/${row.id}`, listHref, "/hod/faculty")}
    />
  );
}

// Faculty Register's "Faculty Timeline" tab - deliberately its own tab/route,
// not a control bolted onto the main register. See FacultyTimelineView for
// the shared filter/select/export UI (also used by Principal's per-department
// timeline), and facultyTimeline.ts for the underlying filter logic.
export default function FacultyTimelinePage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
      <FacultyTimelineContent />
    </Suspense>
  );
}
