"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function ManagementProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/management/profile"
      fetchEndpoint="/api/admin/users/me"
      patchEndpoint="/api/admin/users/me"
    />
  );
}
