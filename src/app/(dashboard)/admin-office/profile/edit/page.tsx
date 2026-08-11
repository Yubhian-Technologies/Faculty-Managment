"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function AdminOfficeProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/admin-office/profile"
      fetchEndpoint="/api/location/users/me"
      patchEndpoint="/api/location/users/me"
    />
  );
}
