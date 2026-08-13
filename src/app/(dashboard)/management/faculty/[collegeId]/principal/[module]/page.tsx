"use client";

import { useParams } from "next/navigation";
import { StaffProfileModuleView } from "@/components/management/StaffProfileView";

export default function ManagementPrincipalModulePage() {
  const { collegeId } = useParams<{ collegeId: string }>();
  return <StaffProfileModuleView collegeId={collegeId} role="PRINCIPAL" backHref={`/management/faculty/${collegeId}/principal`} />;
}
