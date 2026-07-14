"use client";

import { useParams } from "next/navigation";
import { StaffProfileView } from "@/components/management/StaffProfileView";

export default function ManagementVicePrincipalPage() {
  const { collegeId } = useParams<{ collegeId: string }>();
  return <StaffProfileView collegeId={collegeId} role="VICE_PRINCIPAL" title="Vice Principal" backHref={`/management/${collegeId}`} />;
}
