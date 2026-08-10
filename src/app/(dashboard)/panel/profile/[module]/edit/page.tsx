"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function PanelProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/panel/profile" patchEndpoint="/api/college/faculty/me" />;
}
