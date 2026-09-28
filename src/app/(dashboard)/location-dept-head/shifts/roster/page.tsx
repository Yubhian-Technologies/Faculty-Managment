"use client";

import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { ShiftRotationRosterView } from "@/components/location/ShiftRotationRosterView";

export default function DeptHeadShiftRotationRosterPage() {
  const { activeDept, activeDeptId } = useActiveLocationDept();

  return (
    <ShiftRotationRosterView
      departmentId={activeDeptId || undefined}
      departmentName={activeDept?.name}
      backHref="/location-dept-head/shifts"
      manageShiftsHref="/location-dept-head/shifts"
    />
  );
}
