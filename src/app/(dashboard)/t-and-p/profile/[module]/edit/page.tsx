"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function TAndPProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/t-and-p/profile" patchEndpoint="/api/college/users/me" />;
}
