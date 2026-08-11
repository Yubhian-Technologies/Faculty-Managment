"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function HrAdminProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/hr-admin/profile"
      fetchEndpoint="/api/location/users/me"
      patchEndpoint="/api/location/users/me"
    />
  );
}
