"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/store/authStore";

interface CollegeOption {
  id: string;
  name?: string;
}

// FINANCE and PURCHASE_DEPT are GLOBAL roles with no collegeId of their own —
// every /api/college/* call they make needs an explicit collegeId (see
// src/lib/api/collegeFetch.ts), which this picker supplies. Not shown for any
// other role: college-scoped roles already have a fixed session.collegeId.
export function CollegeSwitcher() {
  const role = useAuthStore((s) => s.user?.role);
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);
  const [colleges, setColleges] = useState<CollegeOption[]>([]);

  const shouldShow = role === "FINANCE" || role === "PURCHASE_DEPT";

  useEffect(() => {
    if (!shouldShow) return;
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: CollegeOption[] }>)
      .then((d) => {
        const list = d.colleges ?? [];
        setColleges(list);
        if (!selectedCollegeId && list.length > 0) {
          setSelectedCollegeId(list[0].id);
        }
      })
      .catch(() => {});
    // Only re-run when the role that needs this switcher becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldShow]);

  if (!shouldShow) return null;

  return (
    <Select value={selectedCollegeId ?? undefined} onValueChange={setSelectedCollegeId}>
      <SelectTrigger className="h-9 w-[180px] sm:w-[220px]">
        <Building2 className="h-4 w-4 mr-1 shrink-0 opacity-60" />
        <SelectValue placeholder="Select college" />
      </SelectTrigger>
      <SelectContent>
        {colleges.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name ?? c.id}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
