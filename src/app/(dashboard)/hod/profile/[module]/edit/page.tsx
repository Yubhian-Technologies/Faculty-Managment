"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";
import { FacultyProfileRedirect } from "@/components/faculty/FacultyProfileRedirect";

function HodProfileModuleEditPageContent() {
  return <MyProfileModuleEditPage basePath="/hod/profile" patchEndpoint="/api/college/users/me" />;
}

// A login that has a faculty record is taken to the one faculty profile (the avatar's); anyone else keeps this page.
export default function HodProfileModuleEditPage() {
  return <FacultyProfileRedirect><HodProfileModuleEditPageContent /></FacultyProfileRedirect>;
}
