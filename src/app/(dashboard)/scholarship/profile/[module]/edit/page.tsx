"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function ScholarshipProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/scholarship/profile" patchEndpoint="/api/college/users/me" />;
}
