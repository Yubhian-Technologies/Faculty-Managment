"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function CollegeOfficeProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/college-office/profile" patchEndpoint="/api/college/users/me" />;
}
