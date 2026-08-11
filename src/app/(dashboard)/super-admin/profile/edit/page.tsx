"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function SuperAdminProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/super-admin/profile"
      fetchEndpoint="/api/admin/users/me"
      patchEndpoint="/api/admin/users/me"
    />
  );
}
