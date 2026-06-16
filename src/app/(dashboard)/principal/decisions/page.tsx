"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Users, ChevronRight, CheckCircle2 } from "lucide-react";
import type { HiringBatch } from "@/types";

export default function PrincipalDecisionsPage() {
  const [batches, setBatches] = useState<HiringBatch[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: HiringBatch[] }>)
      .then((d) => {
        const pending = (d.batches ?? []).filter(
          (b) => b.currentPhase === "PRINCIPAL_FINAL_REVIEW" || b.currentPhase === "COMPLETED"
        );
        setBatches(pending);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Hiring Decisions" description="Review evaluations and make final hiring decisions" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Decisions"
        description="Review all candidate evaluations and make final hire / reject decisions"
      />

      {batches.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <CheckCircle2 className="h-10 w-10 text-muted-foreground/30" />
            <p className="font-medium text-muted-foreground">No batches awaiting decision</p>
            <p className="text-sm text-muted-foreground">
              Once the HOD submits interview evaluations, batches will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {batches.map((b) => {
            const isDone = b.currentPhase === "COMPLETED";
            return (
              <Card key={b.id} className={isDone ? "border-green-200 bg-green-50/30" : ""}>
                <CardContent className="p-4 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold">{b.position}</p>
                      {isDone ? (
                        <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">Decisions Made</Badge>
                      ) : (
                        <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">Awaiting Decision</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{b.department}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span><Users className="h-3 w-3 inline mr-1" />{b.candidateIds.length} candidate{b.candidateIds.length !== 1 ? "s" : ""}</span>
                      <span>{formatDate(b.interviewDate)}</span>
                    </div>
                  </div>
                  <Button asChild variant={isDone ? "outline" : "default"} size="sm">
                    <Link href={`/principal/decisions/${b.id}`}>
                      {isDone ? "Review" : "Decide"}
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
