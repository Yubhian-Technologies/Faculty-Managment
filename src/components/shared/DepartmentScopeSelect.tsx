"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import type { Department } from "@/types";

// Lets a parent department's HOD file a new section / subject / faculty member
// under their own department or any of its sub-departments.
//
// Renders NOTHING when the signed-in HOD has no sub-departments, which is the
// common case - so ordinary departments and sub-HODs see no extra field at all,
// and the parent's own department stays the default everywhere.
//
// The value is a department NAME (what section/subject/faculty docs store);
// `departmentId` is reported alongside because the sections API keys off the id.

export interface DepartmentScopeSelectProps {
  value: string;                                   // department name, "" = own
  onChange: (name: string, departmentId: string) => void;
  label?: string;
  /** Shown under the select to explain what the choice affects. */
  hint?: string;
  disabled?: boolean;
}

export function DepartmentScopeSelect({
  value, onChange, label = "Department", hint, disabled,
}: DepartmentScopeSelectProps) {
  const { user } = useAuthStore();
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const d = await fetch("/api/college/departments")
          .then((r) => r.json() as Promise<{ departments: Department[] }>);
        if (!cancelled) setDepartments(d.departments ?? []);
      } catch {
        // Non-fatal: without the list the field simply stays hidden and the
        // caller's own department is used, which is the previous behaviour.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const ownName = user?.department ?? "";
  const own = departments.find((d) => d.name === ownName) ?? null;
  const children = own
    ? departments
        .filter((d) => d.parentDepartmentId === own.id)
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  if (!own || children.length === 0) return null;

  const options = [own, ...children];
  const selectedName = value || ownName;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="department-scope">{label}</Label>
      <select
        id="department-scope"
        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
        value={selectedName}
        disabled={disabled}
        onChange={(e) => {
          const name = e.target.value;
          const match = options.find((d) => d.name === name);
          onChange(name, match?.id ?? "");
        }}
      >
        {options.map((d) => (
          <option key={d.id} value={d.name}>
            {d.name}{d.id === own.id ? " (your department)" : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {hint ?? "You manage this department and its sub-departments."}
      </p>
    </div>
  );
}
