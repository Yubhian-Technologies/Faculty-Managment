"use client";

import { useEffect, useState } from "react";
import { ShiftRotationRosterView } from "@/components/location/ShiftRotationRosterView";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LocationDepartment } from "@/types/locationStaff";

export default function LocationStaffAdminShiftRotationRosterPage() {
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>("ALL");

  useEffect(() => {
    fetch("/api/location/departments")
      .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
      .then((d) => setDepartments((d.departments as LocationDepartment[] | undefined) ?? []))
      .catch(() => {});
  }, []);

  const currentDeptName = departments.find((d) => d.id === selectedDeptId)?.name || "All Campus Departments";

  return (
    <div className="space-y-4">
      {/* Department Selector for Campus-Wide Admin */}
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 bg-card p-3 rounded-xl border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Scope Department:</span>
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="h-8 w-52 text-xs">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments (Campus-wide)</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <ShiftRotationRosterView
        departmentId={selectedDeptId === "ALL" ? undefined : selectedDeptId}
        departmentName={currentDeptName}
        backHref="/location-staff-admin/shifts"
        manageShiftsHref="/location-staff-admin/shifts"
      />
    </div>
  );
}
