import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import type { Department } from "@/types";

// Sub-departments are one level deep only — a sub-department never has
// sub-departments of its own (see Department.parentDepartmentId in
// types/core.ts). So an HOD whose own department already *is* a
// sub-department has nothing to do on the "Sub-Departments" page — it would
// only ever show the "not enabled" empty state. This tells the nav to hide
// that link entirely for them, rather than leave a permanently-dead page in
// their sidebar.
export function useIsSubDepartmentHod() {
  const user = useAuthStore((s) => s.user);
  const [isSubDepartment, setIsSubDepartment] = useState(false);
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
        setIsSubDepartment(!!ownDept?.parentDepartmentId);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.role, user?.uid, user?.department]);

  return { isSubDepartment, loading };
}
