"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QrCode, CheckCircle2 } from "lucide-react";
import { FacultyHome } from "@/components/dashboard/FacultyHome";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatDate } from "@/lib/utils";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import type { HiringBatch } from "@/types";

export default function FacultyDashboard() {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const isHidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const isInterviewsHidden = isHidden("/panel/interviews");

  return (
    <div className="space-y-6">
      {/* Today first: check-in, today's classes, what is waiting, real numbers, coming up, quick actions, roles. */}
      <FacultyHome />

      {/* Interview Panel Assignments - only shown when assigned */}
      {/* Hidden when Navigation Visibility hides interviews; only while assigned. */}
      {!isInterviewsHidden && !isLoading && batches.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-base">Interview Panel Assignments</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link href="/panel/interviews">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">{[1, 2].map((i) => <CardSkeleton key={i} />)}</div>
            ) : (
              <div className="divide-y">
                {batches.slice(0, 5).map((b) => {
                  const isCoordinator = b.coordinatorUid === user?.uid;
                  return (
                    <div key={b.id} className="flex items-center justify-between py-3 gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm truncate">{b.position}</p>
                          {isCoordinator && (
                            <Badge variant="secondary" className="text-xs shrink-0">Coordinator</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(b.interviewDate)}
                          {b.interviewVenue && ` · ${b.interviewVenue}`}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(b.applicationIds ?? []).length} candidate{(b.applicationIds ?? []).length !== 1 ? "s" : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusBadge status={b.status} />
                        {isCoordinator && b.currentPhase === "INTERVIEW_READY" && (
                          <Button size="sm" variant="default" asChild>
                            <Link href={`/coordinator/${b.id}`}>
                              <QrCode className="h-3.5 w-3.5 mr-1" />
                              QR
                            </Link>
                          </Button>
                        )}
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/panel/interviews/${b.id}`}>View</Link>
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completed interviews */}
      {!isLoading && batches.filter((b) => b.status === "COMPLETED").length > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          {batches.filter((b) => b.status === "COMPLETED").length} completed interview{batches.filter((b) => b.status === "COMPLETED").length !== 1 ? "s" : ""} in total
          <Link href="/panel/interviews" className="text-primary underline-offset-4 hover:underline ml-1">
            View history
          </Link>
        </div>
      )}
    </div>
  );
}
