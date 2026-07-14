"use client";

import { useParams } from "next/navigation";
import { StaffProfileView } from "@/components/management/StaffProfileView";

export default function ManagementPrincipalPage() {
  const { collegeId } = useParams<{ collegeId: string }>();
  return <StaffProfileView collegeId={collegeId} role="PRINCIPAL" title="Principal" backHref={`/management/${collegeId}`} />;
}
