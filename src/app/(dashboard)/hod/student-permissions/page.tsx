"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="faculty" tabs={["inbox", "oversight", "new", "routing"]} title="Student Permissions" description="Review department student permission requests and configure routing rules." />;
}
