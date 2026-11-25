"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function ScholarshipProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/scholarship/profile"
      fetchEndpoint="/api/location/users/me"
      patchEndpoint="/api/location/users/me"
    />
  );
}
