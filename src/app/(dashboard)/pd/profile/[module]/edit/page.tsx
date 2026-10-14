"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function PdProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/pd/profile" patchEndpoint="/api/college/users/me" />;
}
