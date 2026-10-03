"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="student" tabs={["new", "mine"]} title="Permissions" description="Request permission for events, certifications, internships and more. Once approved, your attendance is marked On Duty for those days." />;
}
