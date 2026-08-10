"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function HodProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/hod/profile" patchEndpoint="/api/college/users/me" />;
}
