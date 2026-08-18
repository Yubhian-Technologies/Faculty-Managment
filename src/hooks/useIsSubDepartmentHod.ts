import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { useMyDepartments } from "@/hooks/useMyDepartments";
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
  const myDepartments = useMyDepartments();
  const [hideSubDepartmentsLink, setHideSubDepartmentsLink] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Awaited in a wrapper so the setState calls below aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
      if (user?.role !== "HOD") {
        setLoading(false);
        return;
      }

      try {
        const d = await fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>);
        const departments = d.departments ?? [];
        // Visible the moment ANY owned department (not itself a sub-department)
        // has sub-departments enabled - an HOD running several departments at
        // once may only have opted a subset of them in.
        const eligible = myDepartments.some((name) => {
          const own = departments.find((dept) => dept.name === name);
          return !!own && !own.parentDepartmentId && !!own.hasSubDepartments;
        });
        setHideSubDepartmentsLink(!eligible);
      } catch {
        // Non-fatal - the link simply stays visible.
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.role, user?.uid, myDepartments]);

  return { hideSubDepartmentsLink, loading };
}
