"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QrCode } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import type { HiringBatch } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

// A batch is "past" once it's closed out — decided (COMPLETED) or the HOD's
// panel proposal itself was rejected — everything else is still active.
function isPastBatch(b: BatchRow): boolean {
  return b.currentPhase === "COMPLETED" || b.status === "REJECTED";
}

// Panel-member–facing evaluation status derived from the batch phase. Mirrors
// the detail page's `canScore` gate (PANEL_INTERVIEW+) so the list and detail
// agree on when scoring is open.
// ponytail: phase-only, doesn't reflect whether THIS panelist already submitted —
// add a per-batch panel-feedback fetch if a "Submitted" state is wanted here.
function evalStatus(b: BatchRow): { label: string; className: string } {
  switch (b.currentPhase) {
    case "COMPLETED":
      return { label: "Completed", className: "bg-gray-100 text-gray-600 border-gray-200" };
    case "PANEL_INTERVIEW":
    case "PRINCIPAL_FINAL_REVIEW":
      return { label: "Pending Evaluation", className: "bg-amber-50 text-amber-700 border-amber-200" };
    default:
      return { label: "Evaluation Not Opened", className: "bg-slate-50 text-slate-500 border-slate-200" };
  }
}

export default function PanelInterviewsPage() {
  const user = useAuthStore((s) => s.user);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState<"active" | "past">("active");

  useEffect(() => {
    const url =
      user?.role === "PANEL_MEMBER"
        ? "/api/college/hiring-batches"
        : "/api/college/hiring-batches?asPanelMember=true";
    function load() {
      fetch(url)
        .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
        .then((d) => setBatches(d.batches ?? []))
        .catch(() => toast({ variant: "destructive", title: "Failed to load interviews" }))
        .finally(() => setIsLoading(false));
    }
    load();
    // The HOD flips batch phase (scoring open/closed) from another session —
    // refetch on refocus so panel members see it without a manual reload.
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [user?.role]);

  const scopedBatches = batches.filter((b) => (scope === "past" ? isPastBatch(b) : !isPastBatch(b)));

  const columns: Column<BatchRow>[] = [
    {
      key: "position",
      header: "Position",
      render: (row) => (
        <div>
          <p className="font-medium">{row.position as string}</p>
          <p className="text-xs text-muted-foreground">{row.department as string}</p>
        </div>
      ),
    },
    {
      key: "interviewDate",
      header: "Date",
      render: (row) => formatDate(row.interviewDate as Parameters<typeof formatDate>[0]),
    },
    {
      key: "interviewVenue",
      header: "Venue",
      hideOnMobile: true,
      render: (row) => (row.interviewVenue as string) || <span className="text-muted-foreground text-xs">TBA</span>,
    },
    {
      key: "applicationIds",
      header: "Candidates",
      render: (row) => ((row.applicationIds as string[] | undefined) ?? []).length,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const s = evalStatus(row);
        return <Badge variant="outline" className={`text-xs ${s.className}`}>{s.label}</Badge>;
      },
    },
    {
      key: "actions",
      header: "",
      render: (row) => {
        const isCoordinator = (row as unknown as HiringBatch).coordinatorUid === user?.uid;
        return (
          <div className="flex items-center gap-2">
            {isCoordinator && (
              <Badge variant="secondary" className="text-xs shrink-0">Coordinator</Badge>
            )}
            {isCoordinator && (row as unknown as HiringBatch).setupComplete && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/coordinator/${row.id as string}`}>
                  <QrCode className="h-3.5 w-3.5 mr-1" />
                  QR Display
                </Link>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href={`/panel/interviews/${row.id as string}`}>
                View
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Interviews"
        description="Assigned interview batches and feedback submissions"
      />

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "past" ? "default" : "outline"} onClick={() => setScope("past")}>
          Past
        </Button>
      </div>

      <DataTable
        data={scopedBatches}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search interviews..."
        searchKeys={["position", "department"] as (keyof BatchRow)[]}
        emptyTitle={scope === "past" ? "No past interviews" : "No interviews assigned"}
        emptyDescription={
          scope === "past"
            ? "Completed and rejected interviews will show up here."
            : "You will be added to interview panels by the HOD"
        }
        csvFilename="panel-interviews"
      />
    </div>
  );
}
