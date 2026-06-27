"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface LocationInterview {
  id: string;
  title: string;
  interviewDate: unknown;
  venue: string;
  panelMembers: { uid: string; name: string; role: string }[];
  candidatesInfo: { id: string; name: string }[];
  status: string;
  callLetterSent: boolean;
  myFeedbackCount?: number;
}

export default function DeptHeadInterviewsPage() {
  const myUid = useAuthStore((s) => s.user?.uid ?? "");
  const [interviews, setInterviews] = useState<LocationInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/location/interviews")
      .then((r) => r.json() as Promise<{ interviews: LocationInterview[] }>)
      .then((d) => setInterviews(d.interviews ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <div className="text-sm text-muted-foreground p-6">Loading...</div>;

  return (
    <div className="space-y-6">
      <PageHeader title="My Interviews" description="Interviews you are assigned to as a panel member" />

      {interviews.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No interviews assigned to you yet.
        </div>
      ) : (
        <div className="space-y-4">
          {interviews.map((i) => {
            const canScore = i.status === "APPROVED" || i.status === "COMPLETED";
            const candidateCount = i.candidatesInfo?.length ?? 0;

            return (
              <Card key={i.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{i.title}</CardTitle>
                    <StatusBadge status={i.status} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground text-xs">Interview Date</p>
                      <p>{formatDate(i.interviewDate as Parameters<typeof formatDate>[0])}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Venue</p>
                      <p>{i.venue}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Candidates</p>
                      <p>{candidateCount}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">Call Letters</p>
                      <p>{i.callLetterSent ? "Sent" : "Pending"}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button size="sm" asChild variant={canScore ? "default" : "outline"}>
                      <Link href={`/location-dept-head/interviews/${i.id}`}>
                        {canScore ? "View & Score" : "View Details"}
                      </Link>
                    </Button>
                    {canScore && (
                      <Badge variant="outline" className="text-xs text-amber-700 border-amber-300 bg-amber-50">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Score {candidateCount} candidate{candidateCount !== 1 ? "s" : ""}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
