"use client";

import { useParams, useSearchParams } from "next/navigation";
import { ShiftAssignedStaffView } from "@/components/location/ShiftAssignedStaffView";

export default function LocationStaffAdminShiftStaffPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const departmentId = searchParams.get("departmentId") || "";

  const backHref = departmentId
    ? `/location-staff-admin/departments/${departmentId}?tab=shifts`
    : "/location-staff-admin/departments";

  return (
    <ShiftAssignedStaffView
      shiftId={params.id}
      departmentId={departmentId || undefined}
      backHref={backHref}
      staffProfileBasePath="/location-staff-admin/staff"
      readOnly={true}
    />
  );
}
