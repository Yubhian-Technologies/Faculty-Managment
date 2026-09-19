"use client";

import Link from "next/link";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { yearOrdinalLabel } from "@/lib/college/academicYears";
import type { CourseCatalogItem } from "@/types";

export interface CourseSelection {
  catalogId: string;
  assignedYears: number[];
}

interface DepartmentCoursePickerProps {
  catalog: CourseCatalogItem[];
  value: CourseSelection[];
  onChange: (next: CourseSelection[]) => void;
}

// Pick which of the college's courses a new department offers, and which
// years of each it teaches. Ticking a course defaults to every year (the
// common case) - untick the ones it doesn't teach, e.g. a shared first-year
// department only teaching Year 1.
export function DepartmentCoursePicker({ catalog, value, onChange }: DepartmentCoursePickerProps) {
  const active = catalog.filter((c) => c.isActive);

  if (active.length === 0) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        No courses exist yet. A department needs at least one course, so{" "}
        <Link href="/principal/courses" className="font-medium underline">add a course first</Link>.
      </div>
    );
  }

  function toggleCourse(item: CourseCatalogItem, checked: boolean) {
    if (checked) {
      onChange([
        ...value,
        { catalogId: item.id, assignedYears: Array.from({ length: item.durationYears }, (_, i) => i + 1) },
      ]);
    } else {
      onChange(value.filter((v) => v.catalogId !== item.id));
    }
  }

  function toggleYear(catalogId: string, year: number, checked: boolean) {
    onChange(
      value.map((v) =>
        v.catalogId !== catalogId
          ? v
          : {
              ...v,
              assignedYears: checked
                ? [...v.assignedYears, year].sort((a, b) => a - b)
                : v.assignedYears.filter((y) => y !== year),
            }
      )
    );
  }

  return (
    <div className="space-y-2">
      {active.map((item) => {
        const selection = value.find((v) => v.catalogId === item.id);
        return (
          <div key={item.id} className="rounded-md border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`course-${item.id}`}
                checked={!!selection}
                onCheckedChange={(v) => toggleCourse(item, v === true)}
              />
              <Label htmlFor={`course-${item.id}`} className="font-normal">
                {item.name} <span className="text-muted-foreground">({item.code} · {item.durationYears} {item.durationYears === 1 ? "year" : "years"})</span>
              </Label>
            </div>
            {selection && (
              <div className="ml-6 space-y-1">
                <p className="text-xs text-muted-foreground">Years this department teaches</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {Array.from({ length: item.durationYears }, (_, i) => i + 1).map((year) => (
                    <div key={year} className="flex items-center gap-1.5">
                      <Checkbox
                        id={`course-${item.id}-year-${year}`}
                        checked={selection.assignedYears.includes(year)}
                        onCheckedChange={(v) => toggleYear(item.id, year, v === true)}
                      />
                      <Label htmlFor={`course-${item.id}-year-${year}`} className="text-xs font-normal">
                        {yearOrdinalLabel(year)}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
