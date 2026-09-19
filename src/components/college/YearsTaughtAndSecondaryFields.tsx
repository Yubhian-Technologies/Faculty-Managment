"use client";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import { departmentRunsOwnSections } from "@/lib/college/academicStructure";
import type { Department } from "@/types";

// The "Years Taught" + "Secondary Departments" checkbox blocks, shared by the
// flat Add/Edit Department forms and the per-course "Edit Academic Structure"
// dialog (principal/departments/[id]/page.tsx) - same fields, same
// validation, different scope (whole department vs. one course). Kept as one
// component so the three call sites can't drift apart.

interface Props {
  assignedYears: number[];
  onToggleYear: (year: number, checked: boolean) => void;
  /**
   * The course's own durationYears - Years Taught always offers exactly
   * 1..maxYear, full stop. There used to be a separate college-wide "open
   * academic years" list a Principal had to manually grow one year at a time
   * (a "+ Add Year" button) before a longer course's later years became
   * selectable here; the server now auto-opens whichever years a course
   * scope actually uses (ensureAssignedYearsOpen, college/courses POST and
   * college/departments PATCH), so that manual step is gone and this is the
   * only bound left.
   */
  maxYear?: number;
  yearsHelperText: string;
  secondaryDepartmentOptions: Department[];
  secondaryDepartments: string[];
  onToggleSecondaryDepartment: (name: string, checked: boolean) => void;
  /**
   * Hides the "Years Taught" block, leaving only Secondary Departments -
   * years are now decided per-course (at course creation/edit), never on the
   * flat Add/Edit Department forms. Defaults to true (shown) for the other
   * two call sites, which are still per-course.
   */
  showYears?: boolean;
  /**
   * Hides the "Secondary Departments" picker, leaving only Years Taught (when
   * shown) - cross-listing is decided once on Add/Edit Department and a
   * course always follows it, never re-picked per course. Defaults to true
   * (shown) for the Add/Edit Department call sites, which are the only place
   * it's actually editable. When false, `secondaryDepartmentsNote` can render
   * a read-only summary in its place.
   */
  showSecondaryDepartments?: boolean;
  /** Read-only note shown instead of the picker when showSecondaryDepartments is false. */
  secondaryDepartmentsNote?: string;
}

export function YearsTaughtAndSecondaryFields({
  assignedYears, onToggleYear, maxYear, yearsHelperText,
  secondaryDepartmentOptions, secondaryDepartments, onToggleSecondaryDepartment, showYears = true,
  showSecondaryDepartments = true, secondaryDepartmentsNote,
}: Props) {
  const yearOptions = Array.from({ length: maxYear ?? 0 }, (_, i) => i + 1);

  // Only a department that actually enrols students may be cross-listed to.
  // One flagged as organising its sub-departments only
  // (parentRunsOwnSections === false) never holds a section or a student, so
  // naming it here feeds Add Section a destination the server refuses - the
  // branch's real sections live under its children, which are listed
  // separately and are what should be picked instead.
  //
  // Filtered rather than disabled, and kept separate from
  // `secondaryDepartmentOptions` so the "(sub-dept. of …)" labels below still
  // resolve their parent's name from the full list even when that parent is
  // itself not selectable.
  const selectableDepartments = secondaryDepartmentOptions.filter(departmentRunsOwnSections);

  return (
    <>
      {showYears && (
        <div className="space-y-2">
          <Label>Years Taught</Label>
          {yearOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
              Select a course above first.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
              {yearOptions.map((year) => (
                <label key={year} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={assignedYears.includes(year)}
                    onCheckedChange={(checked) => onToggleYear(year, !!checked)}
                  />
                  {yearOrdinalLabel(year)}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{yearsHelperText}</p>
        </div>
      )}

      {showSecondaryDepartments ? (
        <div className="space-y-2">
          <Label>Core Departments</Label>
          {selectableDepartments.length > 0 ? (
            <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
              {selectableDepartments.map((d) => {
                // A sub-department is a valid target (e.g. feeding "ECE-VLSI"
                // specifically, for students admitted straight into that
                // specialization) - the parent's name is shown alongside so
                // it reads as a specific branch, not a plain department.
                const parent = d.parentDepartmentId
                  ? secondaryDepartmentOptions.find((p) => p.id === d.parentDepartmentId)
                  : undefined;
                return (
                  <label key={d.id} className="flex items-center gap-1.5 text-sm">
                    <Checkbox
                      checked={secondaryDepartments.includes(d.name)}
                      onCheckedChange={(checked) => onToggleSecondaryDepartment(d.name, !!checked)}
                    />
                    {d.name}
                    {parent && <span className="text-muted-foreground">(sub-dept. of {parent.name})</span>}
                  </label>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
              No other departments yet
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Optional. Choose the departments these students will move on to. The head of each department you
            pick can then see this department&apos;s sections, students, and staff, but cannot change anything.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-muted-foreground">Core Departments</Label>
          <p className="text-xs text-muted-foreground border rounded-md px-3 py-2">
            {secondaryDepartmentsNote ?? "Follows this department's Core Departments setting (Edit Department page) - not set per course."}
          </p>
        </div>
      )}
    </>
  );
}
