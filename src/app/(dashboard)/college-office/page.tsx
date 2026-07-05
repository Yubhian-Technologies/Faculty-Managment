"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FolderOpen, UserCog, CheckCircle, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { useAuthStore } from "@/store/authStore";
import type { Candidate } from "@/types";

type CandidateRow = Record<string, unknown> & Candidate;

export default function CollegeOfficeDashboard() {
  const user = useAuthStore((s) => s.user);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/candidates")
      .then((r) => r.json() as Promise<{ candidates: CandidateRow[] }>)
      .then((d) => {
        const relevant = (d.candidates ?? []).filter((c) => {
          const stage = (c as unknown as { currentStage?: string }).currentStage;
          return stage === "DOCUMENT_VERIFICATION" || stage === "DECISION";
        });
        setCandidates(relevant as CandidateRow[]);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const pendingVerification = candidates.filter(
    (c) => (c as unknown as { currentStage?: string }).currentStage === "DOCUMENT_VERIFICATION"
  );
  const sentToAccounts = candidates.filter(
    (c) => (c as unknown as { currentStage?: string }).currentStage === "DECISION"
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Office"}`}
        description="Document verification queue for Principal-approved candidates"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {[
          { label: "Docs Pending", value: isLoading ? "—" : pendingVerification.length, icon: Clock, color: "text-orange-600 bg-orange-50", href: "/college-office/candidates" },
          { label: "Sent to Accounts", value: isLoading ? "—" : sentToAccounts.length, icon: CheckCircle, color: "text-blue-600 bg-blue-50", href: "/college-office/candidates" },
          { label: "Total Candidates", value: isLoading ? "—" : candidates.length, icon: UserCog, color: "text-purple-600 bg-purple-50", href: "/college-office/candidates" },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-xl font-bold">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Pending Document Verification</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/college-office/candidates">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
          ) : !pendingVerification.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No candidates pending document verification
            </p>
          ) : (
            <div className="divide-y">
              {pendingVerification.slice(0, 5).map((c) => (
                <div key={c.id as string} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-sm">{c.name as string}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.position as string} · {c.department as string}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">
                      Docs Pending
                    </Badge>
                    <Button size="sm" asChild>
                      <Link href="/college-office/candidates">
                        <FolderOpen className="h-3.5 w-3.5 mr-1" />
                        Verify
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
