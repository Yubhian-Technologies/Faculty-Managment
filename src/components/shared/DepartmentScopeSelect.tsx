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
//
// Two shapes, depending on who's signed in:
//  - Sub-HOD (their own department IS a grouping container, e.g. "BS-Maths"
//    managing IT + CSE): a single "Department" select over the branches they
//    manage. Their own sub-department name is never offered - it's a
//    management container, not a real academic department a section can
//    belong to.
//  - Main/common HOD (their own department has sub-departments, e.g. "Basic
//    Science" split into BS-Maths/BS-English/BS-Physics): a cascading pair -
//    "Sub-Department" first (which of their sub-departments), then, if that
//    sub-department groups branches, "Department" (the real branch it
//    manages). The common department itself ("Basic Science") is never
//    offered either, for the same reason - it exists to organize sub-HODs,
//    not to own sections directly. A sub-department that groups no branches
//    (plain two-level org, no branch-grouping in play) resolves directly once
//    picked, same as before.

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
  const [subDeptId, setSubDeptId] = useState("");
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
  const children = useMemo(
    () => (own ? departments.filter((d) => d.parentDepartmentId === own.id).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [departments, own]
  );
  // Branches grouped under this (sub-)department - the sub-HOD manages them
  // fully, so they can create sections directly under IT/CSBS.
  const managedNames = useMemo(() => new Set(own?.managedDepartments ?? []), [own]);
  const managed = useMemo(
    () => (own ? departments.filter((d) => managedNames.has(d.name)).sort((a, b) => a.name.localeCompare(b.name)) : []),
    [departments, own, managedNames]
  );

  // A grouping container (a sub-department created ONLY to group real branches
  // under a Sub-HOD, e.g. "BS-Maths" managing IT + CSE) is not itself a real
  // academic department, so it must never own sections/subjects/faculty - drop
  // it from the choices and offer only the real branches it manages.
  const isGroupingContainer = managedNames.size > 0;

  // Main/common HOD case: their own department has sub-departments and isn't
  // itself a grouping container. If at least one sub-department groups real
  // branches, the choice must go Sub-Department -> Department instead of a
  // flat list, so a branch is never left owned by a container.
  const groupingChildren = useMemo(
    () => children.filter((c) => (c.managedDepartments?.length ?? 0) > 0),
    [children]
  );
  const useCascade = !isGroupingContainer && Boolean(own?.hasSubDepartments) && groupingChildren.length > 0;

  const selectedChild = useCascade ? children.find((c) => c.id === subDeptId) ?? null : null;
  const childIsGrouping = (selectedChild?.managedDepartments?.length ?? 0) > 0;
  const branchOptions = useMemo(
    () => (selectedChild
      ? departments.filter((d) => (selectedChild.managedDepartments ?? []).includes(d.name)).sort((a, b) => a.name.localeCompare(b.name))
      : []),
    [departments, selectedChild]
  );

  // Memoized so the default-seeding effect below doesn't re-run every render.
  const options = useMemo(() => {
    if (!own) return [];
    return isGroupingContainer ? [...children, ...managed] : [own, ...children, ...managed];
  }, [own, children, managed, isGroupingContainer]);

  // For a grouping container the caller's own department isn't a valid target,
  // so seed the parent form with the first real branch instead of letting it
  // fall back to the container server-side. Only applies to the flat
  // (non-cascading) shape - the cascade always starts unselected so a branch
  // is never picked without the user explicitly choosing its sub-department.
  useEffect(() => {
    if (useCascade || didDefault.current || value !== "" || !isGroupingContainer || options.length === 0) return;
    didDefault.current = true;
    onChange(options[0].name, options[0].id);
  }, [useCascade, value, isGroupingContainer, options, onChange]);

  if (!own || (children.length === 0 && managed.length === 0)) return null;

  if (useCascade) {
    return (
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="sub-department-scope">Sub-Department</Label>
          <select
            id="sub-department-scope"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
            value={subDeptId}
            disabled={disabled}
            onChange={(e) => {
              const id = e.target.value;
              setSubDeptId(id);
              const child = children.find((c) => c.id === id);
              if (!child) { onChange("", ""); return; }
              // A grouping sub-department (BS-Maths managing IT/CSE) needs the
              // Department step below before there's a valid target; a plain
              // sub-department resolves immediately, same as the flat shape.
              if ((child.managedDepartments?.length ?? 0) > 0) onChange("", "");
              else onChange(child.name, child.id);
            }}
          >
            <option value="">Select sub-department</option>
            {children.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {hint ?? `Which of ${own.name}'s sub-departments manages this section.`}
          </p>
        </div>

        {selectedChild && childIsGrouping && (
          <div className="space-y-1.5">
            <Label htmlFor="department-scope">Department</Label>
            <select
              id="department-scope"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none disabled:opacity-50"
              value={value}
              disabled={disabled}
              onChange={(e) => {
                const name = e.target.value;
                const match = branchOptions.find((d) => d.name === name);
                onChange(name, match?.id ?? "");
              }}
            >
              <option value="">Select department</option>
              {branchOptions.map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              The real branch this section belongs to - {selectedChild.name} manages its students and sections.
            </p>
          </div>
        )}
      </div>
    );
  }

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
