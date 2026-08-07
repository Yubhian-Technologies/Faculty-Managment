"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { LeaveProfileView } from "@/components/leave/LeaveProfileView";

export default function PrincipalEmployeeLeaveHistoryPage({
  params,
}: {
  params: Promise<{ deptId: string; uid: string }>;
}) {
  const { deptId, uid } = use(params);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave History"
        description="Full leave record for this employee"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/principal/leave-history/${deptId}`}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Roster
            </Link>
          </Button>
        }
      />
      <LeaveProfileView uid={uid} historyBaseHref={`/principal/leave-history/${deptId}/${uid}/history`} />
    </div>
  );
}
