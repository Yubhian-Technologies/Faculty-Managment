"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CollegeOption {
  id: string;
  name?: string;
}

// FINANCE and PURCHASE_DEPT are GLOBAL roles with no collegeId of their own -
// every /api/college/* call they make needs an explicit collegeId (see
// src/lib/api/collegeFetch.ts). This used to auto-select the first college
// silently with no visible indicator, which made it impossible to tell (or
// fix) when it picked a different college than the one you meant to act on -
// e.g. a budget cycle released here landing in a college a Principal on a
// different college never sees. Now it's a real, visible, switchable control.
export function CollegeSwitcher() {
  const role = useAuthStore((s) => s.user?.role);
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  const needsCollege = role === "FINANCE" || role === "PURCHASE_DEPT";

  useEffect(() => {
    if (!needsCollege) return;
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: CollegeOption[] }>)
      .then((d) => {
        const list = d.colleges ?? [];
        setColleges(list);
        // Only auto-pick when nothing is selected yet - never override an
        // explicit choice already made (including one persisted from a
        // previous session).
        if (!selectedCollegeId && list.length > 0) setSelectedCollegeId(list[0].id);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // Only re-run when the role that needs this becomes active.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCollege]);

  if (!needsCollege || !loaded || colleges.length === 0) return null;

  // Single college: nothing to choose, but still show which one it is.
  if (colleges.length === 1) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 text-sm text-muted-foreground px-2">
        <Building2 className="h-4 w-4" />
        <span className="max-w-40 truncate">{colleges[0].name ?? colleges[0].id}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Building2 className="h-4 w-4 text-muted-foreground hidden sm:block shrink-0" />
      <Select value={selectedCollegeId ?? undefined} onValueChange={setSelectedCollegeId}>
        <SelectTrigger className="h-9 w-36 sm:w-52 text-sm">
          <SelectValue placeholder="Select college" />
        </SelectTrigger>
        <SelectContent>
          {colleges.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
