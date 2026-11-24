"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function HrProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/hr/profile" patchEndpoint="/api/college/users/me" />;
}
