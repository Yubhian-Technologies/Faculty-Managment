"use client";

import { useParams } from "next/navigation";
import { LocationStaffProfileView } from "@/components/location/LocationStaffProfileView";

export default function LocationDeptHeadStaffProfilePage() {
  const params = useParams<{ id: string }>();
  return <LocationStaffProfileView staffId={params.id} backHref="/location-dept-head/staff" />;
}
