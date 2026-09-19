"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationInterview {
  id: string;
  title: string;
  interviewDate: unknown;
  venue: string;
  panelMembers: { uid: string; name: string; role: string }[];
  candidatesInfo: { id: string; name: string }[];
  shortlistedCandidateIds: string[];
  status: string;
  createdByName: string;
  notes?: string;
  createdAt: unknown;
  collegeName?: string;
}

export default function AdminInterviewsPage() {
  const isMobile = useMobile();
  const searchParams = useSearchParams();
  const collegeId = searchParams.get("collegeId");
  const collegeName = searchParams.get("collegeName");
  const [interviews, setInterviews] = useState<LocationInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    const url = collegeId ? `/api/location/interviews?collegeId=${collegeId}` : "/api/location/interviews";
    fetch(url)
      .then((r) => r.json() as Promise<{ interviews: LocationInterview[] }>)
      .then((d) => setInterviews(d.interviews ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [collegeId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Plans"
        description="Review, approve and score interview plans submitted by HR Admin"
      />

      {collegeId && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>
            Filtered to <strong>{collegeName || "this college"}</strong>
          </span>
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-xs">
            <Link href="/administration/interviews"><X className="h-3 w-3" /> Clear filter</Link>
          </Button>
        </div>
      )}

      {isMobile ? (
        <div className="space-y-3">
          {interviews.map((i) => (
            <MobileCard
              key={i.id}
              title={i.title}
              subtitle={`Created by ${i.createdByName}`}
              badge={<StatusBadge status={i.status} />}
              fields={[
                { label: "College", value: i.collegeName || "-" },
                { label: "Interview Date", value: formatDate(i.interviewDate as Parameters<typeof formatDate>[0]) },
                { label: "Venue", value: i.venue },
                { label: "Candidates", value: i.shortlistedCandidateIds?.length ?? 0 },
                { label: "Panel", value: i.panelMembers?.length ?? 0 },
              ]}
              actions={
                <Button size="sm" variant="outline" asChild className="flex-1">
                  <Link href={`/administration/interviews/${i.id}`}>
                    {i.status === "PENDING_ADMIN" ? "Review & Approve" : "View & Score"}
                  </Link>
                </Button>
              }
            />
          ))}
          {!isLoading && interviews.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No interview plans yet.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={interviews as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search by title..."
          searchKeys={["title", "createdByName", "venue"]}
          csvFilename="admin-interview-plans"
          columns={[
            { key: "title", header: "Interview Title" },
            { key: "collegeName", header: "College", render: (r) => (r as unknown as LocationInterview).collegeName || "-" },
            {
              key: "interviewDate", header: "Date",
              render: (r) => formatDate((r as unknown as LocationInterview).interviewDate as Parameters<typeof formatDate>[0]),
            },
            { key: "venue", header: "Venue" },
            {
              key: "candidates", header: "Candidates",
              render: (r) => (r as unknown as LocationInterview).shortlistedCandidateIds?.length ?? 0,
            },
            { key: "createdByName", header: "Submitted By" },
            {
              key: "status", header: "Status",
              render: (r) => <StatusBadge status={(r as unknown as LocationInterview).status} />,
            },
            {
              key: "actions",
              header: "",
              render: (r) => {
                const i = r as unknown as LocationInterview;
                return (
                  <Button size="sm" variant={i.status === "PENDING_ADMIN" ? "default" : "outline"} asChild>
                    <Link href={`/administration/interviews/${i.id}`}>
                      {i.status === "PENDING_ADMIN" ? "Review & Approve" : "View & Score"}
                    </Link>
                  </Button>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}
