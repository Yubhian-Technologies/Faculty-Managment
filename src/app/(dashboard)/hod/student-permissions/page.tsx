"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="faculty" tabs={["inbox", "oversight", "new", "routing"]} title="Student Permissions" description="Approve student permission requests for your department and, where the Principal allows, set their routing." />;
}
