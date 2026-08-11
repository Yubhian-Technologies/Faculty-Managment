"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function ManagementProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/management/profile"
      fetchEndpoint="/api/admin/users/me"
      photoEndpoint="/api/admin/users/me/photo"
    />
  );
}
