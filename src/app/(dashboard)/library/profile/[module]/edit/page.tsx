"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function LibraryProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/library/profile" patchEndpoint="/api/college/users/me" />;
}
