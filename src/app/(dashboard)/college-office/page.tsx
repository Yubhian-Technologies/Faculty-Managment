"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle, GraduationCap, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { useAuthStore } from "@/store/authStore";
import type { Candidate, CandidateApplication } from "@/types";

type CandidateRow = { id: string; name: string; position: string; department: string };

export default function CollegeOfficeDashboard() {
  const user = useAuthStore((s) => s.user);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/college/candidate-applications?stage=DECISION").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
    ])
      .then(([appsRes, candsRes]) => {
        const personMap = new Map((candsRes.candidates ?? []).map((c) => [c.id, c]));
        const relevant = (appsRes.applications ?? []).map((a) => ({
          id: a.id,
          name: personMap.get(a.candidateId)?.name ?? "Unknown",
          position: a.position,
          department: a.department,
        }));
        setCandidates(relevant);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name ?? "Office"}`}
        description="Principal-approved candidates sent to Accounts"
      />

      <div className="flex flex-wrap gap-4">
        <Link href="/college-office/candidates" className="block">
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

        <Link href="/college-office/students" className="block">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-emerald-600 bg-emerald-50">
                <GraduationCap className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Students</p>
                <p className="text-sm font-semibold">Add, view or remove</p>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/college-office/faculty" className="block">
          <Card className="hover:shadow-md transition-shadow cursor-pointer">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 text-violet-600 bg-violet-50">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Faculty</p>
                <p className="text-sm font-semibold">Promotion &amp; salary</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

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
