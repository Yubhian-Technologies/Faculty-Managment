import { useEffect, useState } from "react";
import { useAuthStore } from "@/store/authStore";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { normalizeStoredRole } from "@/lib/roles/seatRoles";
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
  // Heads a department under ANY of the shapes a login can carry it: the
  // primary `role`, or an HOD seat held by someone whose own role is
  // something else (a faculty member appointed HOD keeps role
  // "PANEL_MEMBER" and gets seatRoles: ["HOD"] - see resolveHeldRoles).
  // Testing `role === "HOD"` alone skipped every seat-held HOD, so the
  // check below never ran for them and the link stayed visible for every
  // department, opted in or not. DEPARTMENT_OFFICE normalises to HOD.
  const heldRoles = useAuthStore((s) => s.user?.roles ?? s.user?.seatRoles);
  const headsADepartment = !!user &&
    [user.role, ...(heldRoles ?? [])].some((r) => normalizeStoredRole(r) === "HOD");
  const [hideSubDepartmentsLink, setHideSubDepartmentsLink] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Awaited in a wrapper so the setState calls below aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => {
      if (!headsADepartment) {
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
  }, [headsADepartment, user?.uid, myDepartments]);

  return { hideSubDepartmentsLink, loading };
}
