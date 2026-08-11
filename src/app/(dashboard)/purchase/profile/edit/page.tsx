"use client";

import { MyAccountProfileEditPage } from "@/components/shared/MyAccountProfileEditPage";

export default function PurchaseProfileEditPage() {
  return (
    <MyAccountProfileEditPage
      basePath="/purchase/profile"
      fetchEndpoint="/api/admin/users/me"
      patchEndpoint="/api/admin/users/me"
    />
  );
}
