"use client";

import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { Building2, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

export function LocationDeptSwitcher() {
  const { myDepartments, activeDept, setActiveDeptId, hasMultipleDepts, isLoading } =
    useActiveLocationDept();

  if (isLoading || myDepartments.length === 0) return null;

  // Single department: render a clean badge/label
  if (!hasMultipleDepts) {
    return (
      <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
        <Building2 className="h-3.5 w-3.5" />
        <span className="truncate max-w-[140px]">{activeDept?.name ?? "Department"}</span>
      </div>
    );
  }

  // Multiple departments: interactive switcher dropdown
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-semibold px-2.5 rounded-full border-primary/30 bg-background/80 hover:bg-primary/5 shadow-xs"
        >
          <Building2 className="h-3.5 w-3.5 text-primary" />
          <span className="truncate max-w-[130px] sm:max-w-[180px]">
            {activeDept?.name ?? "Switch Department"}
          </span>
          <ChevronDown className="h-3 w-3 opacity-60 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1">
        <DropdownMenuLabel className="text-xs text-muted-foreground font-medium">
          Assigned Departments
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {myDepartments.map((dept) => (
          <DropdownMenuItem
            key={dept.id}
            onClick={() => setActiveDeptId(dept.id)}
            className={`text-xs cursor-pointer flex items-center justify-between py-2 ${
              dept.id === activeDept?.id ? "bg-primary/10 font-bold text-primary" : ""
            }`}
          >
            <span className="truncate">{dept.name}</span>
            {dept.code && (
              <span className="text-[10px] text-muted-foreground ml-2 px-1.5 py-0.5 bg-muted rounded">
                {dept.code}
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
