"use client";

import { useParams } from "next/navigation";
import { StaffProfileModuleView } from "@/components/management/StaffProfileView";

export default function ManagementVicePrincipalModulePage() {
  const { collegeId } = useParams<{ collegeId: string }>();
  return <StaffProfileModuleView collegeId={collegeId} role="VICE_PRINCIPAL" backHref={`/management/faculty/${collegeId}/vice-principal`} />;
}
