"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function AdministrationProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/administration/profile"
      fetchEndpoint="/api/location/users/me"
      patchEndpoint="/api/location/users/me"
    />
  );
}
