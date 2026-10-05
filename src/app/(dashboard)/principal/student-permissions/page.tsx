"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="faculty" tabs={["inbox", "oversight", "new", "routing"]} title="Student Permissions" description="Oversee student permission requests and configure who approves what, per department and type." />;
}
