"use client";

import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
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
          <Label>Secondary Departments</Label>
          {secondaryDepartmentOptions.length > 0 ? (
            <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
              {secondaryDepartmentOptions.map((d) => (
                <label key={d.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={secondaryDepartments.includes(d.name)}
                    onCheckedChange={(checked) => onToggleSecondaryDepartment(d.name, !!checked)}
                  />
                  {d.name}
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
              No other top-level departments yet
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Optional - every section College Office creates under this department will be cross-listed to all
            selected departments, so each one&apos;s HOD gets automatic view-only access to its students,
            roster, and assigned faculty (e.g. a shared first-year department feeding both CSE and ECE).
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <Label className="text-muted-foreground">Secondary Departments</Label>
          <p className="text-xs text-muted-foreground border rounded-md px-3 py-2">
            {secondaryDepartmentsNote ?? "Follows this department's Secondary Departments setting (Edit Department page) - not set per course."}
          </p>
        </div>
      )}
    </>
  );
}
