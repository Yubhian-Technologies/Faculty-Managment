import { useMemo } from "react";
import { useAuthStore } from "@/store/authStore";
import { useWorkContext } from "@/hooks/useWorkContext";
import { departmentOfContext } from "@/lib/roles/activeHodDepartment";

const EMPTY: string[] = [];

// Every department the current login's own account is HOD of - the client
// mirror of getHodDepartmentScope's `ownDepartmentNames` (src/lib/departments/
// scope.ts). `user.departments` is the canonical field once present; a login
// that predates it (or was only ever touched by the old single-value write
// path) falls back to its one `department` string. Usually one entry - an
// HOD can now be assigned more than one department by the Principal (see
// principal/departments), which is what most callers actually care about
// here: `.length > 1` is the signal to show a department picker/switcher
// instead of assuming a single implicit department.
//
// Memoized (not a fresh array literal per render) - callers routinely put
// this straight into a useEffect/useMemo dependency array, where a new array
// identity every render would re-run the effect in an infinite loop.
export function useMyDepartments(): string[] {
  const departments = useAuthStore((s) => s.user?.departments);
  const department = useAuthStore((s) => s.user?.department);
  // A head of several departments works in the one picked in "Working as".
  const picked = departmentOfContext(useWorkContext().active);
  return useMemo(() => {
    const all = departments && departments.length > 0 ? departments : department ? [department] : EMPTY;
    return picked && all.includes(picked) ? [picked] : all;
  }, [departments, department, picked]);
}
