"use client";

import { MyAccountProfileView } from "@/components/shared/MyAccountProfileView";

export default function FinanceProfilePage() {
  return (
    <MyAccountProfileView
      basePath="/finance/profile"
      fetchEndpoint="/api/admin/users/me"
      photoEndpoint="/api/admin/users/me/photo"
    />
  );
}
