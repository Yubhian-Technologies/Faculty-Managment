"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="student" tabs={["new", "mine", "section"]} title="Permissions" description="Submit and track student permission requests for academic activities, events, and internships." />;
}
