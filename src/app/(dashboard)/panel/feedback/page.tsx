"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { PanelFeedback } from "@/types";

type FeedbackRow = Record<string, unknown> & PanelFeedback;

const RECOMMENDATION_LABELS: Record<string, string> = {
  RECOMMENDED: "Recommended",
  NOT_RECOMMENDED: "Not Recommended",
  HOLD: "Hold",
};

export default function PanelFeedbackPage() {
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/panel-feedback")
      .then((r) => r.json() as Promise<{ feedback: FeedbackRow[] }>)
      .then((d) => setFeedback(d.feedback ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load feedback" }))
      .finally(() => setIsLoading(false));
  }, []);

  const columns: Column<FeedbackRow>[] = [
    {
      key: "candidateId",
      header: "Candidate",
      render: (row) => (row.candidateName as string) || (row.candidateId as string),
    },
    {
      key: "recommendation",
      header: "Recommendation",
      render: (row) => {
        const rec = row.recommendation as string;
        const color =
          rec === "RECOMMENDED" ? "text-green-600" : rec === "NOT_RECOMMENDED" ? "text-red-600" : "text-orange-600";
        return <span className={`text-sm font-medium ${color}`}>{RECOMMENDATION_LABELS[rec] ?? rec}</span>;
      },
    },
    {
      key: "ratings",
      header: "Avg Rating",
      render: (row) => {
        const ratings = row.ratings as Record<string, number> | undefined;
        if (!ratings) return "—";
        const vals = Object.values(ratings).filter((v) => v > 0);
        if (vals.length === 0) return "—";
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        return `${avg.toFixed(1)} / 5`;
      },
    },
    {
      key: "comments",
      header: "Comments",
      hideOnMobile: true,
      render: (row) => {
        const c = (row.comments as string) || "";
        return c.length > 60 ? c.slice(0, 60) + "…" : c || <span className="text-muted-foreground text-xs">—</span>;
      },
    },
    {
      key: "createdAt",
      header: "Submitted",
      render: (row) => formatDate(row.createdAt as Parameters<typeof formatDate>[0]),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Feedback"
        description="Interview feedback you have submitted"
      />

      <DataTable
        data={feedback}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search feedback..."
        searchKeys={["candidateId"] as (keyof FeedbackRow)[]}
        emptyTitle="No feedback submitted yet"
        emptyDescription="Go to My Interviews to submit feedback for candidates"
        csvFilename="panel-feedback"
      />
    </div>
  );
}
