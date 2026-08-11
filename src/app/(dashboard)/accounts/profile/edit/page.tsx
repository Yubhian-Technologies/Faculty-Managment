"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function AccountsProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/accounts/profile"
      fetchEndpoint="/api/location/users/me"
      patchEndpoint="/api/location/users/me"
    />
  );
}
