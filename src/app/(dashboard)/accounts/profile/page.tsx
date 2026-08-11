"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function AccountsProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/accounts/profile"
      fetchEndpoint="/api/location/users/me"
      photoEndpoint="/api/location/users/me/photo"
    />
  );
}
