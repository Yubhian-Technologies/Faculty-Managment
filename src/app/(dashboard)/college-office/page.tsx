"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle } from "lucide-react";
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
        const relevant = (d.candidates ?? []).filter(
          (c) => (c as unknown as { currentStage?: string }).currentStage === "DECISION"
        );
        setCandidates(relevant as CandidateRow[]);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Office"}`}
        description="Principal-approved candidates sent to Accounts"
      />

      <Link href="/college-office/candidates" className="block w-fit">
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-blue-600 bg-blue-50">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Sent to Accounts</p>
              <p className="text-xl font-bold">{isLoading ? "—" : candidates.length}</p>
            </div>
          </CardContent>
        </Card>
      </Link>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
          <CardTitle className="text-base">Recently Sent to Accounts</CardTitle>
          <Button variant="outline" size="sm" asChild>
            <Link href="/college-office/candidates">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
          ) : !candidates.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No candidates sent to Accounts yet
            </p>
          ) : (
            <div className="divide-y">
              {candidates.slice(0, 5).map((c) => (
                <div key={c.id as string} className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium text-sm">{c.name as string}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.position as string} · {c.department as string}
                    </p>
                  </div>
                  <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">
                    Sent to Accounts
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
