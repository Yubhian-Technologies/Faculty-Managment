"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function AdministrationProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/administration/profile"
      fetchEndpoint="/api/location/users/me"
      photoEndpoint="/api/location/users/me/photo"
    />
  );
}
