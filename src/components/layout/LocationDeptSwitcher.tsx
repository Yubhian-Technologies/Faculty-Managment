"use client";

import { Building2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// `compact` is the desktop sidebar's icon rail: only an icon, same menu.
export function LocationDeptSwitcher({ compact = false }: { compact?: boolean }) {
  const user = useAuthStore((s) => s.user);
  const { myDepartments, activeDeptId, setActiveDeptId, hasMultipleDepts, isLoading } =
    useActiveLocationDept();

  // The department switcher is strictly for a LOCATION_DEPT_HEAD heading multiple departments
  if (user?.role !== "LOCATION_DEPT_HEAD" || isLoading || !hasMultipleDepts || !activeDeptId) {
    return null;
  }

  if (compact) {
    return (
      <div className="px-2 pt-3 shrink-0">
        <Select value={activeDeptId} onValueChange={(val) => setActiveDeptId(val)}>
          <SelectTrigger className="h-10 w-full justify-center px-0 [&>svg:last-child]:hidden" title="Switch department" aria-label="Switch department">
            <Building2 className="h-4 w-4" />
            <span className="sr-only"><SelectValue placeholder="Select Department" /></span>
          </SelectTrigger>
          <SelectContent className="min-w-56">
            {myDepartments.map((dept) => (
              <SelectItem key={dept.id} value={dept.id}>
                {dept.name} {dept.code ? `(${dept.code})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <div className="px-3 pt-3 shrink-0">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-1 pb-1">
        Department
      </p>
      <Select value={activeDeptId} onValueChange={(val) => setActiveDeptId(val)}>
        <SelectTrigger className="h-9">
          <SelectValue placeholder="Select Department" />
        </SelectTrigger>
        <SelectContent>
          {myDepartments.map((dept) => (
            <SelectItem key={dept.id} value={dept.id}>
              {dept.name} {dept.code ? `(${dept.code})` : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
