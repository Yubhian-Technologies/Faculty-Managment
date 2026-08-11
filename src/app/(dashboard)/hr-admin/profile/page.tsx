"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function HrAdminProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/hr-admin/profile"
      fetchEndpoint="/api/location/users/me"
      photoEndpoint="/api/location/users/me/photo"
    />
  );
}
