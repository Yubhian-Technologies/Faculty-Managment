"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function LocationDeptHeadProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/location-dept-head/profile"
      fetchEndpoint="/api/location/users/me"
      photoEndpoint="/api/location/users/me/photo"
    />
  );
}
