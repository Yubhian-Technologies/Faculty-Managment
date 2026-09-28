"use client";

import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { ShiftWiseAttendanceView } from "@/components/location/ShiftWiseAttendanceView";

export default function DeptHeadShiftWiseAttendancePage() {
  const { activeDept, activeDeptId } = useActiveLocationDept();

  return (
    <ShiftWiseAttendanceView
      departmentId={activeDeptId || undefined}
      departmentName={activeDept?.name}
      backHref="/location-dept-head/attendance"
      manageShiftsHref="/location-dept-head/shifts"
    />
  );
}
