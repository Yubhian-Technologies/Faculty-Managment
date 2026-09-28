"use client";

import { useEffect, useState } from "react";
import { ShiftWiseAttendanceView } from "@/components/location/ShiftWiseAttendanceView";
import type { LocationDepartment } from "@/types/locationStaff";

export default function LocationStaffAdminShiftWiseAttendancePage() {
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>("");

  useEffect(() => {
    fetch("/api/location/departments")
      .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
      .then((d) => {
        const list = (d.departments as LocationDepartment[] | undefined) ?? [];
        setDepartments(list);
        if (list.length > 0 && !selectedDeptId) {
          setSelectedDeptId(list[0].id);
        }
      })
      .catch(() => {});
  }, [selectedDeptId]);

  const currentDeptName = departments.find((d) => d.id === selectedDeptId)?.name || "Department";

  return (
    <ShiftWiseAttendanceView
      departmentId={selectedDeptId}
      departmentName={currentDeptName}
      departments={departments}
      onDepartmentChange={setSelectedDeptId}
      backHref="/location-staff-admin/attendance"
      manageShiftsHref="/location-staff-admin/shifts"
    />
  );
}
