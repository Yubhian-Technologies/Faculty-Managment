"use client";

import { Badge } from "@/components/ui/badge";
import { getFreshmanDepartmentIds, type DepartmentWithId } from "@/lib/college/academicStructure";

interface FreshmanDepartmentBadgeProps {
  departmentId: string;
  allDepartments: DepartmentWithId[];
  className?: string;
}

// Marks EVERY department that qualifies as a shared/common first-year
// department - e.g. "Basic Science" when every branch's 1st years sit under
// it before promotion. A college can have more than one of these,
// independent of each other (see getFreshmanDepartmentIds's own doc-comment -
// deliberately NOT structureFromDepartments()'s single `commonDepartment`,
// which picks only one by design for its own, functionally different
// callers). Renders nothing for every ordinary branch department, and
// nothing at all for a college with no such department.
export function FreshmanDepartmentBadge({ departmentId, allDepartments, className }: FreshmanDepartmentBadgeProps) {
  const freshmanIds = getFreshmanDepartmentIds(allDepartments);
  if (!freshmanIds.has(departmentId)) return null;
  return (
    <Badge variant="outline" className={`text-xs border-violet-300 bg-violet-50 text-violet-700 ${className ?? ""}`}>
      Freshman&apos;s Department
    </Badge>
  );
}
