"use client";

import { MyProfileModulePage } from "@/components/faculty/MyProfileModulePage";
import { FacultyProfileRedirect } from "@/components/faculty/FacultyProfileRedirect";

function HodProfileModulePageContent() {
  return <MyProfileModulePage basePath="/hod/profile" />;
}

// A login that has a faculty record is taken to the one faculty profile (the avatar's); anyone else keeps this page.
export default function HodProfileModulePage() {
  return <FacultyProfileRedirect><HodProfileModulePageContent /></FacultyProfileRedirect>;
}
