"use client";

import { InchargeTimetableWorkspace } from "@/components/timetable/InchargeTimetableWorkspace";

// A delegated Timetable Incharge's timetable: course & year + section filters, then Load.
export default function TimetableInchargePage() {
  return <InchargeTimetableWorkspace basePath="/panel/timetable-incharge" />;
}
