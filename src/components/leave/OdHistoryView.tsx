"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { ArrowLeft, History } from "lucide-react";
import { LeaveHistoryRow } from "./LeaveProfileView";
import type { LeaveRequest } from "@/types/leave";

interface OdHistoryViewProps {
  uid?: string; // omit to view the signed-in user's own OD history
  backHref: string;
}

export function OdHistoryView({ uid, backHref }: OdHistoryViewProps) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const qs = uid ? `?uid=${uid}` : "";
    fetch(`/api/leave/applications${qs}`)
      .then((r) => r.json() as Promise<{ requests: LeaveRequest[] }>)
      .then((data) => setRequests((data.requests ?? []).filter((r) => r.leaveTypeCode === "OD")))
      .catch(() => toast({ variant: "destructive", title: "Failed to load On Duty history" }))
      .finally(() => setIsLoading(false));
  }, [uid]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="On Duty History"
        description="All On Duty requests - no annual limit"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to Leave Profile
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <EmptyState icon={<History className="h-6 w-6" />} title="No On Duty requests yet" />
          ) : (
            <div className="space-y-2">
              {requests.map((r) => (
                <LeaveHistoryRow key={r.id} request={r} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
