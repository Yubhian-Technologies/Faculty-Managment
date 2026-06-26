"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  shortlistedCandidateIds: string[];
  status: string;
  callLetterSent: boolean;
  createdAt: unknown;
}

export default function HRInterviewsPage() {
  const isMobile = useMobile();
  const [interviews, setInterviews] = useState<LocationInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sending, setSending] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/location/interviews")
      .then((r) => r.json() as Promise<{ interviews: LocationInterview[] }>)
      .then((d) => setInterviews(d.interviews ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load interviews" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function sendCallLetters(interviewId: string) {
    setSending(interviewId);
    try {
      const res = await fetch(`/api/location/interviews/${interviewId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SEND_CALL_LETTERS" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Call letters sent", description: "Candidates and panel members have been notified." });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to send call letters" });
    } finally {
      setSending(null);
    }
  }

  const renderActions = (i: LocationInterview) => (
    <div className="flex gap-2">
      <Button size="sm" variant="outline" asChild>
        <Link href={`/hr-admin/interviews/${i.id}`}>View</Link>
      </Button>
      {i.status === "APPROVED" && !i.callLetterSent && (
        <Button size="sm" onClick={() => void sendCallLetters(i.id)} loading={sending === i.id}>
          Send Call Letters
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Plans"
        description="Create and manage faculty interview plans"
        actions={
          <Button asChild>
            <Link href="/hr-admin/interviews/new">+ New Interview Plan</Link>
          </Button>
        }
      />

      {isMobile ? (
        <div className="space-y-3">
          {interviews.map((i) => (
            <MobileCard
              key={i.id}
              title={i.title}
              subtitle={`${i.shortlistedCandidateIds?.length ?? 0} candidates · ${i.panelMembers?.length ?? 0} panel members`}
              badge={<StatusBadge status={i.status} />}
              fields={[
                { label: "Interview Date", value: formatDate(i.interviewDate as Parameters<typeof formatDate>[0]) },
                { label: "Venue", value: i.venue },
                { label: "Call Letters", value: i.callLetterSent ? "Sent" : "Not sent" },
              ]}
              actions={renderActions(i)}
            />
          ))}
          {!isLoading && interviews.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No interview plans yet. Create one after shortlisting candidates.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={interviews as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search by title, venue..."
          searchKeys={["title", "venue"]}
          csvFilename="hr-interviews"
          columns={[
            { key: "title", header: "Interview Title" },
            { key: "interviewDate", header: "Date", render: (r) => formatDate((r as unknown as LocationInterview).interviewDate as Parameters<typeof formatDate>[0]) },
            { key: "venue", header: "Venue" },
            { key: "candidates", header: "Candidates", render: (r) => (r as unknown as LocationInterview).shortlistedCandidateIds?.length ?? 0 },
            { key: "panel", header: "Panel", render: (r) => (r as unknown as LocationInterview).panelMembers?.length ?? 0 },
            { key: "callLetterSent", header: "Call Letters", render: (r) => (r as unknown as LocationInterview).callLetterSent ? "Sent" : "Pending" },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationInterview).status} /> },
            { key: "actions", header: "Actions", render: (r) => renderActions(r as unknown as LocationInterview) },
          ]}
        />
      )}
    </div>
  );
}
