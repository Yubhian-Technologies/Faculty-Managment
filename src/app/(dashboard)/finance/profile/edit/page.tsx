"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function FinanceProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/finance/profile"
      fetchEndpoint="/api/admin/users/me"
      patchEndpoint="/api/admin/users/me"
    />
  );
}
