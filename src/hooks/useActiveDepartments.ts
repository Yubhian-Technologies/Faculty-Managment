import { useEffect, useState } from "react";
import type { Department } from "@/types";

// Fetches this college's active departments once - the identical
// fetch("/api/college/departments") + isActive filter that used to be
// copy-pasted across the Non-Technical Staff new/edit/import pages
// (college-office/non-technical-staff/*). Empty array while loading and on
// failure - callers treat department assignment as optional either way.
export function useActiveDepartments() {
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive)))
      .catch(() => { /* department assignment is optional */ });
  }, []);

  return departments;
}
