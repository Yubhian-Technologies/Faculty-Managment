"use client";

import { MyProfileModuleEditPage } from "@/components/faculty/MyProfileModuleEditPage";
import { FACULTY_REQUIRED_PERSONAL_FIELDS } from "@/components/shared/PersonalDetailsFields";

// Panel Members are provisioned as Faculty records (role: PANEL_MEMBER,
// UI label "Faculty" - see the hiring pipeline's Stage 14), so their
// self-profile uses Faculty's relaxed personal-details requirement
// (Name as per Aadhar optional), not Staff's.
export default function PanelProfileModuleEditPage() {
  return (
    <MyProfileModuleEditPage
      basePath="/panel/profile"
      patchEndpoint="/api/college/faculty/me"
      requiredPersonalFields={FACULTY_REQUIRED_PERSONAL_FIELDS}
    />
  );
}
