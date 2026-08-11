"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function DeanProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/dean/profile" patchEndpoint="/api/college/users/me" />;
}
