"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, Plus, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AttachToVacancyDialog } from "@/components/hiring/AttachToVacancyDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { CANDIDATE_STAGE_LABELS } from "@/types";
import type { Candidate, CandidateApplication } from "@/types";

export default function HODCandidateDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const candidateId = params.id;

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [applications, setApplications] = useState<CandidateApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [attachOpen, setAttachOpen] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  async function toggleShortlist(app: CandidateApplication) {
    setToggling(app.id);
    try {
      const res = await fetch(`/api/college/candidate-applications/${app.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isShortlisted: !app.isShortlisted }),
      });
      if (!res.ok) throw new Error();
      setApplications((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, isShortlisted: !app.isShortlisted } : a))
      );
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setToggling(null);
    }
  }

  const load = useCallback(() => {
    setIsLoading(true);
    void Promise.all([
      fetch(`/api/college/candidates/${candidateId}`)
        .then((r) => r.json() as Promise<{ candidate?: Candidate; error?: string }>),
      fetch(`/api/college/candidate-applications?candidateId=${candidateId}`)
        .then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>)
        .then((d) => d.applications ?? []),
    ])
      .then(([candidateRes, applicationsRes]) => {
        if (!candidateRes.candidate) {
          toast({ variant: "destructive", title: "Candidate not found" });
          router.push("/hod/candidates");
          return;
        }
        setCandidate(candidateRes.candidate);
        setApplications(applicationsRes);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidate" }))
      .finally(() => setIsLoading(false));
  }, [candidateId, router]);

  useEffect(() => { load(); }, [load]);

  if (isLoading || !candidate) {
    return (
      <div className="space-y-6">
        <PageHeader title="Candidate" />
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={candidate.name}
        description={candidate.email}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/hod/candidates"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
            </Button>
            <Button size="sm" onClick={() => setAttachOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Attach to Hiring Request
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Candidate Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p>{candidate.phone}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Source</p>
              <p>{candidate.source}</p>
            </div>
            {candidate.source === "REFERRAL" && candidate.referralName && (
              <div>
                <p className="text-xs text-muted-foreground">Referred by</p>
                <p>{candidate.referralName}</p>
              </div>
            )}
            {candidate.resumeUrl && (
              <div>
                <p className="text-xs text-muted-foreground">Resume</p>
                <a
                  href={candidate.resumeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> View
                </a>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Bio-data submitted</p>
              <p>{candidate.bioDataSubmitted ? "Yes" : "No"}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Hiring Request Applications</CardTitle>
          </CardHeader>
          <CardContent>
            {applications.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <p className="text-sm text-muted-foreground">Not attached to any hiring request yet</p>
                <Button size="sm" onClick={() => setAttachOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" /> Attach to Hiring Request
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {applications.map((a) => (
                  <div key={a.id} className="rounded-lg border px-4 py-3 space-y-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{a.position}</p>
                        <p className="text-xs text-muted-foreground">{a.department}</p>
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <StatusBadge status={a.status} />
                        <p className="text-xs text-muted-foreground">{CANDIDATE_STAGE_LABELS[a.currentStage]}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap pt-1">
                      {!a.batchId && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          loading={toggling === a.id}
                          onClick={() => void toggleShortlist(a)}
                        >
                          {a.isShortlisted ? "Unshortlist" : "Shortlist"}
                        </Button>
                      )}
                      {a.isShortlisted && <Badge variant="outline">Shortlisted</Badge>}
                      {a.hasArrived && <Badge variant="outline">Arrived</Badge>}
                      {a.batchId ? (
                        <Link href={`/hod/batches/${a.batchId}`} className="text-xs text-primary hover:underline">
                          View interview batch
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not yet scheduled for interview</span>
                      )}
                      <span className="text-xs text-muted-foreground/60 ml-auto">
                        Attached {formatDate(a.createdAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AttachToVacancyDialog
        candidateId={candidateId}
        candidateName={candidate.name}
        open={attachOpen}
        onOpenChange={setAttachOpen}
        onAttached={load}
      />
    </div>
  );
}
