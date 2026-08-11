"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function RAndDProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/r-and-d/profile" patchEndpoint="/api/college/users/me" />;
}
