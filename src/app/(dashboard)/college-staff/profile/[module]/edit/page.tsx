"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function CollegeStaffProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/college-staff/profile" patchEndpoint="/api/college/users/me" />;
}
