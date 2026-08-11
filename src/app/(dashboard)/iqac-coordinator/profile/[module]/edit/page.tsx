"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function IqacCoordinatorProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/iqac-coordinator/profile" patchEndpoint="/api/college/users/me" />;
}
