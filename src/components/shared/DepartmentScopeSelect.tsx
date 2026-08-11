"use client";

import { useEffect, useMemo, useState, useRef } from "react";
import { Label } from "@/components/ui/label";
import { useAuthStore } from "@/store/authStore";
import type { Department } from "@/types";

// Lets an HOD file a new section / subject / faculty member under their own
// department, any of its sub-departments, or any branch grouped/managed under
// it (a sub-HOD who manages IT + CSBS can create sections directly under IT).
//
// Renders NOTHING when the signed-in HOD has neither sub-departments nor managed
// branches, which is the common case - so ordinary departments see no extra
// field at all and their own department stays the default everywhere.
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
  const didDefault = useRef(false);

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
  // Branches grouped under this (sub-)department - the sub-HOD manages them
  // fully, so they can create sections directly under IT/CSBS.
  const managedNames = new Set((own?.managedDepartments ?? []));
  const managed = own
    ? departments
        .filter((d) => managedNames.has(d.name))
        .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  // A grouping container (a sub-department created ONLY to group real branches
  // under a Sub-HOD, e.g. "BS-Maths" managing IT + CSE) is not itself a real
  // academic department, so it must never own sections/subjects/faculty - drop
  // it from the choices and offer only the real branches it manages.
  const isGroupingContainer = managedNames.size > 0;
  // Memoized so the default-seeding effect below doesn't re-run every render.
  const options = useMemo(() => {
    if (!own) return [];
    const ch = departments
      .filter((d) => d.parentDepartmentId === own.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    const mg = departments
      .filter((d) => (own.managedDepartments ?? []).includes(d.name))
      .sort((a, b) => a.name.localeCompare(b.name));
    return (own.managedDepartments?.length ?? 0) > 0 ? [...ch, ...mg] : [own, ...ch, ...mg];
  }, [departments, own]);

  // For a grouping container the caller's own department isn't a valid target,
  // so seed the parent form with the first real branch instead of letting it
  // fall back to the container server-side.
  useEffect(() => {
    if (didDefault.current || value !== "" || !isGroupingContainer || options.length === 0) return;
    didDefault.current = true;
    onChange(options[0].name, options[0].id);
  }, [value, isGroupingContainer, options, onChange]);

  if (!own || (children.length === 0 && managed.length === 0)) return null;

  const selectedName = value || options[0]?.name || ownName;

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
            {d.name}
            {d.id === own.id ? " (your department)" : managedNames.has(d.name) ? " (managed branch)" : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {hint ?? "You manage this department, its sub-departments, and any grouped branches."}
      </p>
    </div>
  );
}
