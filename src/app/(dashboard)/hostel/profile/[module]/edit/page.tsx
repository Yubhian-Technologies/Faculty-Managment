"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function HostelProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/hostel/profile" patchEndpoint="/api/college/users/me" />;
}
