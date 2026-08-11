"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function PlacementDeptProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/placement-dept/profile" patchEndpoint="/api/college/users/me" />;
}
