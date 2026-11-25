"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function ScholarshipProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/scholarship/profile"
      fetchEndpoint="/api/location/users/me"
      photoEndpoint="/api/location/users/me/photo"
    />
  );
}
