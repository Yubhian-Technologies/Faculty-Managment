"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function SuperAdminProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/super-admin/profile"
      fetchEndpoint="/api/admin/users/me"
      photoEndpoint="/api/admin/users/me/photo"
    />
  );
}
