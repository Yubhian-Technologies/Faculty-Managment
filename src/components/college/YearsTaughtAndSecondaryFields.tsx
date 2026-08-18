"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { AcademicYear, Department } from "@/types";

// The "Years Taught" + "Secondary Departments" checkbox blocks, shared by the
// flat Add/Edit Department forms and the per-course "Edit Academic Structure"
// dialog (principal/departments/[id]/page.tsx) - same fields, same
// validation, different scope (whole department vs. one course). Kept as one
// component so the three call sites can't drift apart.

interface Props {
  openYears: AcademicYear[];
  onAddYear: () => void;
  isAddingYear: boolean;
  assignedYears: number[];
  onToggleYear: (year: number, checked: boolean) => void;
  /**
   * Bounds which open years are offered - omitted for a department-wide
   * (flat) edit, or a course's own durationYears for a per-course override,
   * so the checklist can't offer a year the course doesn't span.
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
}

export function YearsTaughtAndSecondaryFields({
  openYears, onAddYear, isAddingYear, assignedYears, onToggleYear, maxYear, yearsHelperText,
  secondaryDepartmentOptions, secondaryDepartments, onToggleSecondaryDepartment, showYears = true,
}: Props) {
  const yearOptions = maxYear != null ? openYears.filter((y) => y.yearNumber <= maxYear) : openYears;

  return (
    <>
      {showYears && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Years Taught</Label>
            <Button type="button" variant="outline" size="sm" onClick={onAddYear} loading={isAddingYear}>
              + Add Year
            </Button>
          </div>
          {yearOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground border rounded-md px-3 py-2">
              {openYears.length === 0
                ? 'No academic years added yet for this college - use "+ Add Year" above.'
                : "No open years within this course's duration yet."}
            </p>
          ) : (
            <div className="flex flex-wrap gap-3 border rounded-md px-3 py-2">
              {yearOptions.map((y) => (
                <label key={y.yearNumber} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={assignedYears.includes(y.yearNumber)}
                    onCheckedChange={(checked) => onToggleYear(y.yearNumber, !!checked)}
                  />
                  {yearOrdinalLabel(y.yearNumber)}
                </label>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">{yearsHelperText}</p>
        </div>
      )}

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
    </>
  );
}
