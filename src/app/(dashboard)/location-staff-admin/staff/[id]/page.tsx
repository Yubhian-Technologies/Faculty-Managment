"use client";

import { useParams } from "next/navigation";
import { LocationStaffProfileView } from "@/components/location/LocationStaffProfileView";

export default function LocationStaffAdminStaffProfilePage() {
  const params = useParams<{ id: string }>();
  return <LocationStaffProfileView staffId={params.id} backHref="/location-staff-admin/departments" />;
}
