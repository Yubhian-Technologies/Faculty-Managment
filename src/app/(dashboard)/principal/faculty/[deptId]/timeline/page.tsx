"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { UsersRound } from "lucide-react";
import { FacultyTimelineView } from "@/components/faculty/FacultyTimelineView";
import type { Department } from "@/types";

// Same Faculty Timeline tab as the HOD's Faculty Register (see
// FacultyTimelineView), scoped to this one department - reached from the
// department's own faculty list (principal/faculty/[deptId]/page.tsx) via its
// filterComponent, same placement (right after the search bar) as hod/faculty.
export default function PrincipalDepartmentFacultyTimelinePage() {
  const { deptId } = useParams<{ deptId: string }>();

  const { data: departments = [] } = useQuery({
    queryKey: ["principal-faculty-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });
  const department = departments.find((d) => d.id === deptId);

  // An empty `department` query param reads as "no filter" to the API (every
  // college faculty, unscoped) - wait for the real name to resolve rather
  // than flashing the whole college's roster first.
  if (!department) {
    return (
      <p className="text-sm text-muted-foreground flex items-center gap-2">
        <UsersRound className="h-4 w-4" /> Resolving department…
      </p>
    );
  }

  return (
    <FacultyTimelineView
      fetchUrl={`/api/college/faculty?department=${encodeURIComponent(department.name)}`}
      backHref={`/principal/faculty/${deptId}`}
      backLabel="Back to Department Faculty"
      rowHref={(row) => `/principal/faculty/${deptId}/${row.id}`}
    />
  );
}
