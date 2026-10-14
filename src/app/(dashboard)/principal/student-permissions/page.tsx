"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="faculty" tabs={["inbox", "oversight", "new", "routing"]} title="Student Permissions" description="College-wide student permission oversight and approval chain configuration." />;
}
