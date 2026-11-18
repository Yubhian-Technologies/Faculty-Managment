"use client";

import { useParams } from "next/navigation";
import { TimetableGridEditor } from "@/components/timetable/TimetableGridEditor";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/shared/EmptyState";

// The College Admin / Principal editing any section's timetable (Timetables > Edit Timetable): the HOD's editor with
// full rights. Their changes are stamped "Updated by <name> (Admin)" on the section (lib/timetable/adminStamp.ts).
// The Vice Principal reaches /principal/* too, but this editor is the Principal's only.
export default function PrincipalTimetableEditPage() {
  const { courseId, year, sectionId } = useParams<{ courseId: string; year: string; sectionId: string }>();
  const { user } = useAuth();
  if (user && user.role !== "PRINCIPAL" && user.realRole !== "COLLEGE_ADMIN") {
    return <EmptyState title="Only the Principal or College Admin can edit timetables here." />;
  }
  return <TimetableGridEditor courseId={courseId} year={year} sectionId={sectionId} backHref="/principal/timetable" asAdmin />;
}
