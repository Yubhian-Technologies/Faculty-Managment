"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function CollegeAccountsProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/college-accounts/profile" patchEndpoint="/api/college/users/me" />;
}
