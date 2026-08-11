"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function AdminOfficeProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/admin-office/profile"
      fetchEndpoint="/api/location/users/me"
      photoEndpoint="/api/location/users/me/photo"
    />
  );
}
