"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function LocationDeptHeadProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/location-dept-head/profile"
      fetchEndpoint="/api/location/users/me"
      patchEndpoint="/api/location/users/me"
    />
  );
}
