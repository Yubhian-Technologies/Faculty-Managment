"use client";

import { MyProfileModulePage } from "@/components/faculty/MyProfileModulePage";

// Panel Members are provisioned as Faculty records (role: PANEL_MEMBER) with
// their own Identity & Employment page (/panel/profile) already showing Full
// Name (as per SSC) right after Employee ID (see FacultyIdentityFacts) - hidden
// here so this Personal Details tab doesn't show it a second time.
export default function PanelProfileModulePage() {
  return <MyProfileModulePage basePath="/panel/profile" hideLegalName ratificationHistory />;
}
