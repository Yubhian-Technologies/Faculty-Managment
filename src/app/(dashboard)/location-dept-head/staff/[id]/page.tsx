"use client";

import { useParams, useSearchParams } from "next/navigation";
import { LocationStaffProfileView } from "@/components/location/LocationStaffProfileView";
import { resolveListBack } from "@/lib/listReturn";

export default function LocationDeptHeadStaffProfilePage() {
  const params = useParams<{ id: string }>();
  // Back returns to the roster as it was opened from (search, filters).
  const backHref = resolveListBack(useSearchParams(), "/location-dept-head/staff");
  return <LocationStaffProfileView staffId={params.id} backHref={backHref} />;
}
