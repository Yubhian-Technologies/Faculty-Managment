import { useMemo } from "react";
import { useAuthStore } from "@/store/authStore";

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
  return useMemo(() => {
    if (departments && departments.length > 0) return departments;
    return department ? [department] : EMPTY;
  }, [departments, department]);
}
