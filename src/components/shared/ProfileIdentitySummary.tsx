"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

interface Props {
  user: Pick<FMSUser, "name" | "email" | "role" | "department">;
  /** Shown instead of Department - Principal/VP carry a designation, not a department. */
  designation?: string;
  /** e.g. "Sub-department of Basic Science" - HOD's own department context. */
  departmentBadge?: string;
}

// The identity block every "My Profile" page opens with, for the ~14
// college-scoped roles (Principal down to Panel Member). One definition so
// all of them show the same minimal, at-a-glance fields - who they are, what
// they do, and (new) which college they belong to - instead of each page
// hand-rolling its own copy of this grid and drifting out of sync. College
// isn't on the `user` object itself (only a bare collegeId - see
// FMSUser.collegeId), so it's resolved here via the same /api/college/info
// every other "show the college's own name" page already reuses.
export function ProfileIdentitySummary({ user, designation, departmentBadge }: Props) {
  const [collegeName, setCollegeName] = useState<string | undefined>(undefined);
  const [loadingCollege, setLoadingCollege] = useState(true);

  useEffect(() => {
    fetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name?: string }>)
      .then((d) => setCollegeName(d.name))
      .catch(() => {})
      .finally(() => setLoadingCollege(false));
  }, []);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
      <div>
        <p className="text-xs text-muted-foreground">Name</p>
        <p className="text-sm font-medium">{user.name}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Email</p>
        <p className="text-sm font-medium">{user.email}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">Role</p>
        <p className="text-sm font-medium">{ROLE_LABELS[user.role]}</p>
      </div>
      <div>
        <p className="text-xs text-muted-foreground">College</p>
        <p className="text-sm font-medium">{loadingCollege ? "…" : collegeName || "-"}</p>
      </div>
      {designation && (
        <div>
          <p className="text-xs text-muted-foreground">Designation</p>
          <p className="text-sm font-medium">{designation}</p>
        </div>
      )}
      {user.department && (
        <div>
          <p className="text-xs text-muted-foreground">Department</p>
          <p className="text-sm font-medium flex items-center gap-1.5">
            {user.department}
            {departmentBadge && <Badge variant="secondary" className="text-xs">{departmentBadge}</Badge>}
          </p>
        </div>
      )}
    </div>
  );
}
