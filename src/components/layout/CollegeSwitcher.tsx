"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/authStore";

interface CollegeOption {
  id: string;
  name?: string;
}

// FINANCE and PURCHASE_DEPT are GLOBAL roles with no collegeId of their own —
// every /api/college/* call they make needs an explicit collegeId (see
// src/lib/api/collegeFetch.ts). There is no visible switcher UI; this silently
// auto-selects the first college on login (and stays put after, since
// selectedCollegeId is persisted) so those roles' /api/college/* calls keep
// working without a header control.
export function CollegeSwitcher() {
  const role = useAuthStore((s) => s.user?.role);
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);

  const shouldAutoSelect = role === "FINANCE" || role === "PURCHASE_DEPT";

  useEffect(() => {
    if (!shouldAutoSelect || selectedCollegeId) return;
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: CollegeOption[] }>)
      .then((d) => {
        const list = d.colleges ?? [];
        if (list.length > 0) setSelectedCollegeId(list[0].id);
      })
      .catch(() => {});
    // Only re-run when the role that needs auto-selection becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoSelect]);

  return null;
}
