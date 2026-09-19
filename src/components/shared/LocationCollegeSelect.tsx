"use client";

import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface CollegeOption {
  id: string;
  name?: string;
  isActive?: boolean;
}

const ALL_COLLEGES = "__all__";

interface LocationCollegeSelectProps {
  value: string;
  onChange: (collegeId: string) => void;
  /** Adds an "All Colleges" option that reports back as "". Off by default -
   * a submission form (Vacancy Request, Add Candidate) always wants one
   * specific college picked, never "all of them". */
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
}

// Colleges belonging to the caller's own location - GET /api/admin/colleges
// already scopes to session.locationId for every non-Super-Admin role
// (Administration, HR Admin, Admin Office, Location Dept Head), so this needs
// no locationId prop of its own. Plain controlled component (no global store,
// no auto-pick) - unlike CollegeSwitcher.tsx, which is a sticky, always-on
// header control for GLOBAL roles with no location of their own, this is a
// one-off picker used inline on a form or dashboard.
export function LocationCollegeSelect({ value, onChange, allowEmpty, placeholder, className }: LocationCollegeSelectProps) {
  const [colleges, setColleges] = useState<CollegeOption[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: CollegeOption[] }>)
      .then((d) => setColleges((d.colleges ?? []).filter((c) => c.isActive !== false)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <Building2 className="h-4 w-4 text-muted-foreground hidden sm:block shrink-0" />
      <Select
        value={value || (allowEmpty ? ALL_COLLEGES : undefined)}
        onValueChange={(v) => onChange(v === ALL_COLLEGES ? "" : v)}
      >
        <SelectTrigger className={className ?? "h-9 w-full sm:w-64 text-sm"}>
          <SelectValue placeholder={placeholder ?? (loaded && colleges.length === 0 ? "No colleges yet" : "Select college...")} />
        </SelectTrigger>
        <SelectContent>
          {allowEmpty && <SelectItem value={ALL_COLLEGES}>All Colleges</SelectItem>}
          {colleges.map((c) => (
            <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
