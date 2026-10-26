"use client";

import { Badge } from "@/components/ui/badge";
import { deriveDepartmentRole, type RoleInput } from "@/lib/departments/departmentRole";

interface DepartmentRoleBadgeProps {
  departmentId: string;
  allDepartments: RoleInput[];
  className?: string;
}

const LABEL: Record<string, string> = {
  PARENT: "Parent",
  CHILD: "Child",
  GHOST: "Ghost",
  NEIGHBOUR: "Neighbour",
  NEIGHBOUR_SUB: "Neighbour Sub-Dept",
};

const STYLE: Record<string, string> = {
  PARENT: "border-blue-300 bg-blue-50 text-blue-700",
  CHILD: "border-sky-300 bg-sky-50 text-sky-700",
  GHOST: "border-slate-300 bg-slate-50 text-slate-700",
  NEIGHBOUR: "border-amber-300 bg-amber-50 text-amber-700",
  NEIGHBOUR_SUB: "border-amber-300 bg-amber-50 text-amber-700",
};

// Advisory-only role label (PARENT/CHILD/GHOST/NEIGHBOUR/NEIGHBOUR_SUB) - a
// human-readable name for what Department's existing structural fields
// already mean (see Department.departmentRole's own doc-comment,
// src/types/core.ts). ALWAYS calls deriveDepartmentRole() live rather than
// trusting the stored Department.departmentRole field, so a stale backfill
// can never display something no longer true. Renders nothing if the
// department isn't found - same defensive shape as FreshmanDepartmentBadge.
export function DepartmentRoleBadge({ departmentId, allDepartments, className }: DepartmentRoleBadgeProps) {
  const dept = allDepartments.find((d) => d.id === departmentId);
  if (!dept) return null;
  const { role, flags } = deriveDepartmentRole(dept, allDepartments);
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap text-xs ${STYLE[role]} ${className ?? ""}`}
      title={flags.length > 0 ? `Flagged for review: ${flags.join(", ")}` : undefined}
    >
      {LABEL[role]}
      {flags.length > 0 ? " ⚠" : ""}
    </Badge>
  );
}
