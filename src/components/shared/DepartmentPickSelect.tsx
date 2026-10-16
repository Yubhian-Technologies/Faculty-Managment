"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEPARTMENT_PICK_ALL, type DepartmentPickOption } from "@/lib/departments/departmentPickTree";

/**
 * The one Department filter: sub-departments and core branches sit indented under
 * the department that owns them, so there is no separate Sub-department or Core
 * department field. Options come from `buildDepartmentPickOptions`.
 */
export function DepartmentPickSelect({
  value, onChange, options, allLabel = "All departments", hideAll = false, placeholder, disabled, className = "sm:w-56", id,
}: {
  value: string;
  onChange: (value: string) => void;
  options: DepartmentPickOption[];
  allLabel?: string;
  /** A required pick (no "All" entry), e.g. a report that is always for one department. */
  hideAll?: boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className={className}><SelectValue placeholder={placeholder ?? allLabel} /></SelectTrigger>
      <SelectContent>
        {!hideAll && <SelectItem value={DEPARTMENT_PICK_ALL}>{allLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem
            key={o.value}
            value={o.value}
            className={o.depth === 1 ? "pl-8" : o.depth === 2 ? "pl-12" : undefined}
          >
            {o.label}{o.container ? " (all sub-departments)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
