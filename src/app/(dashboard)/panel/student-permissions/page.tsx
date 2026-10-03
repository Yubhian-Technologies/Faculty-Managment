"use client";

import { PermissionsWorkspace } from "@/components/studentPermissions/PermissionsWorkspace";

export default function Page() {
  return <PermissionsWorkspace mode="faculty" tabs={["new", "mine", "inbox"]} title="Student Permissions" description="Raise permission requests on behalf of students, and decide the ones routed to you." />;
}
