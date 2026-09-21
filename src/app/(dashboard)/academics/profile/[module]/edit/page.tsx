"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function AcademicsProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/academics/profile" patchEndpoint="/api/college/users/me" />;
}
