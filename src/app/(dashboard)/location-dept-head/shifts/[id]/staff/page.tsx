"use client";

import { useParams } from "next/navigation";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { ShiftAssignedStaffView } from "@/components/location/ShiftAssignedStaffView";

export default function DeptHeadShiftAssignedStaffPage() {
  const params = useParams<{ id: string }>();
  const { activeDeptId } = useActiveLocationDept();

  return (
    <ShiftAssignedStaffView
      shiftId={params.id}
      departmentId={activeDeptId || undefined}
      backHref="/location-dept-head/shifts"
      takeAttendanceHref={`/location-dept-head/attendance/shift?shiftId=${params.id}`}
      assignMoreHref={`/location-dept-head/shifts/${params.id}/assign`}
      rosterRotationHref="/location-dept-head/shifts/roster"
      staffProfileBasePath="/location-dept-head/staff"
    />
  );
}
