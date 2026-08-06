import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import type { Department } from "@/types";

// The "Sub-Departments" nav link only ever leads somewhere useful when the
// HOD's own department both (a) isn't itself a sub-department - sub-
// departments are one level deep only, see Department.parentDepartmentId in
// types/core.ts - and (b) has hasSubDepartments enabled by the Principal
// (see Department.hasSubDepartments). Either gap lands on the page's own
// empty state (src/app/(dashboard)/hod/settings/sub-departments/page.tsx),
// so this hides the link entirely instead of leaving a dead entry in the
// sidebar for every HOD whose department hasn't opted in.
export function useIsSubDepartmentHod() {
  const user = useAuthStore((s) => s.user);
  const [hideSubDepartmentsLink, setHideSubDepartmentsLink] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.role !== "HOD") {
      setLoading(false);
      return;
    }

    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: Department[] }>)
      .then((d) => {
        const ownDept = (d.departments ?? []).find((dept) => dept.name === user.department);
        setHideSubDepartmentsLink(!!ownDept?.parentDepartmentId || !ownDept?.hasSubDepartments);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, user?.uid, user?.department]);

  return { hideSubDepartmentsLink, loading };
}
