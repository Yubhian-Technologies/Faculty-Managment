"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Department } from "@/types";

interface CollegeDepartmentSelectProps {
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// Department picker fed by the college's own department list (Academics >
// Departments), so forms outside the academics module can't drift into
// free-text department names. The value is the department NAME, which is what
// those forms/documents store. A pre-filled value that isn't in the list (e.g.
// a since-renamed department on an older record) is kept as an option so the
// form never silently blanks it.
export function CollegeDepartmentSelect({ value, onChange, placeholder = "Select department", disabled }: CollegeDepartmentSelectProps) {
  const [names, setNames] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments?: Department[] }>)
      .then((d) =>
        setNames(
          (d.departments ?? [])
            .filter((x) => x.isActive !== false)
            .map((x) => x.name)
            .sort((a, b) => a.localeCompare(b))
        )
      )
      .catch(() => setNames([]))
      .finally(() => setLoading(false));
  }, []);

  const options = value && !names.includes(value) ? [value, ...names] : names;

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger><SelectValue placeholder={loading ? "Loading departments..." : placeholder} /></SelectTrigger>
      <SelectContent>
        {options.length === 0 ? (
          <SelectItem value="__none" disabled>No departments found</SelectItem>
        ) : (
          options.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)
        )}
      </SelectContent>
    </Select>
  );
}
