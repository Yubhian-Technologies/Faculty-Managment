"use client";

import { useParams, useSearchParams } from "next/navigation";
import { LocationStaffProfileView } from "@/components/location/LocationStaffProfileView";
import { safeListBack, LIST_BACK_PARAM } from "@/lib/listReturn";

export default function LocationStaffAdminStaffProfilePage() {
  const params = useParams<{ id: string }>();
  // Opened from the Staff directory: Back returns to it as it was (search, filters).
  // Opened from Departments / Attendance (no `back`): Back goes where it always did.
  const backHref = safeListBack(useSearchParams().get(LIST_BACK_PARAM), "/location-staff-admin/staff") ?? "/location-staff-admin/departments";
  return <LocationStaffProfileView staffId={params.id} backHref={backHref} />;
}
