"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="faculty" tabs={["new", "mine", "inbox"]} title="Student Permissions" description="Submit student permission requests and review assigned approvals." />;
}
