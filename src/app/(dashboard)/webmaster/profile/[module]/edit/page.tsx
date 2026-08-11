"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function WebmasterProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/webmaster/profile" patchEndpoint="/api/college/users/me" />;
}
