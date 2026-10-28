"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { MidTimetableViewer } from "@/components/midTimetable/MidTimetableViewer";

// Published Mid exam timetables (read-only; the API decides which branches).
export default function MidTimetablePage() {
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Mid Timetable" description="Mid exam dates and sessions, as published by the Exam Cell." />
      <MidTimetableViewer emptyText="The Mid exam timetables of the branches you teach appear here once the Exam Cell publishes them." />
    </div>
  );
}
