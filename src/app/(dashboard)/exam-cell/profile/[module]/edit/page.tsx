"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";

export default function ExamCellProfileModuleEditPage() {
  return <MyProfileModuleEditPage basePath="/exam-cell/profile" patchEndpoint="/api/college/users/me" />;
}
