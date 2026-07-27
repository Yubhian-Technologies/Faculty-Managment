"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { ExternalLink, FileText, Users, Calendar, Briefcase, Pencil } from "lucide-react";
import { ROLE_LABELS } from "@/types";
import type { HiringBatch, Candidate, FMSUser } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function InterviewDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();

  const [detailBatch, setDetailBatch] = useState<BatchRow | null>(null);
  const [loadingBatch, setLoadingBatch] = useState(true);
  const [detailCandidates, setDetailCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [allUsers, setAllUsers] = useState<FMSUser[]>([]);

  const initialAction = searchParams.get("action");
  const [action, setAction] = useState<"approve" | "reject" | null>(
    initialAction === "approve" || initialAction === "reject" ? initialAction : null
  );
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  // Modify plan state
  const [editing, setEditing] = useState(false);
  const [editDate, setEditDate] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editVenue, setEditVenue] = useState("");
  const [editPanel, setEditPanel] = useState<string[]>([]);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  function loadPage() {
    setLoadingBatch(true);
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
      .then((d) => {
        const batch = (d.batches ?? []).find((b) => b.id === id) ?? null;
        if (!batch) {
          toast({ variant: "destructive", title: "Interview plan not found" });
          router.push("/principal/interviews");
          return;
        }
        setDetailBatch(batch);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load interview plan" }))
      .finally(() => setLoadingBatch(false));
  }

  useEffect(() => {
    loadPage();
    fetch("/api/college/users?allDepts=true&includeAll=true")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setAllUsers(d.users ?? []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setDetailCandidates([]);
    setLoadingCandidates(true);
    fetch(`/api/college/candidates?batchId=${id}`)
      .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
      .then((d) => setDetailCandidates(d.candidates ?? []))
      .catch(() => {})
      .finally(() => setLoadingCandidates(false));
  }, [id]);

  function openEdit() {
    if (!detailBatch) return;
    const d = detailBatch.interviewDate as { seconds?: number } | string | Date | null;
    if (d && typeof d === "object" && "seconds" in d && d.seconds) {
      setEditDate(new Date(d.seconds * 1000).toISOString().split("T")[0]);
    } else if (d instanceof Date) {
      setEditDate(d.toISOString().split("T")[0]);
    } else if (typeof d === "string") {
      setEditDate(d.split("T")[0]);
    } else {
      setEditDate("");
    }
    setEditTime((detailBatch.interviewTime as string) ?? "");
    setEditVenue((detailBatch.interviewVenue as string) ?? "");
    setEditPanel([...(detailBatch.panelMemberUids as string[] ?? [])]);
    setEditing(true);
  }

  async function saveEdit() {
    if (!editDate) {
      toast({ variant: "destructive", title: "Interview date is required" });
      return;
    }
    if (editPanel.length < 2) {
      toast({ variant: "destructive", title: "Select at least 2 panel members" });
      return;
    }
    setIsSavingEdit(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewDate: editDate,
          interviewTime: editTime,
          interviewVenue: editVenue,
          panelMemberUids: editPanel,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Plan updated" });
      setEditing(false);
      loadPage();
    } catch {
      toast({ variant: "destructive", title: "Failed to update plan" });
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleAction() {
    if (!detailBatch || !action) return;
    setLoading(true);
    try {
      const statusMap = { approve: "APPROVED", reject: "REJECTED" } as const;
      const res = await fetch(`/api/college/hiring-batches/${detailBatch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statusMap[action], principalNotes: notes }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: action === "approve" ? "Plan approved" : "Plan rejected",
        description: "HOD has been notified.",
      });
      router.push("/principal/interviews");
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setLoading(false);
    }
  }

  const isPending = detailBatch?.status === "PENDING";

  if (loadingBatch) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Interview Plan" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={detailBatch?.position as string}
        description={detailBatch?.department as string}
        actions={
          <div className="flex items-center gap-2">
            {detailBatch && <StatusBadge status={(detailBatch as unknown as HiringBatch).status} />}
            {!editing && (
              <Button size="sm" variant="outline" onClick={openEdit}>
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Modify Plan
              </Button>
            )}
          </div>
        }
      />

      {/* ── Modify Plan form ───────────────────────────────────────────────── */}
      {editing && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Modify Interview Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Interview Date *</Label>
                <Input
                  type="date"
                  value={editDate}
                  onChange={(e) => setEditDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Interview Time</Label>
                <Input
                  type="time"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Venue</Label>
              <Input
                value={editVenue}
                onChange={(e) => setEditVenue(e.target.value)}
                placeholder="e.g. Conference Hall, Block B"
              />
            </div>

            <div className="space-y-2">
              <Label>
                Panel Members *
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {editPanel.length} selected (min 2)
                </span>
              </Label>
              <div className="max-h-56 overflow-y-auto rounded-md border p-2 space-y-1">
                {allUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground p-2">No staff found</p>
                ) : (
                  allUsers.map((u) => (
                    <div key={u.uid} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/40">
                      <Checkbox
                        id={`ep-${u.uid}`}
                        checked={editPanel.includes(u.uid)}
                        onCheckedChange={(checked) =>
                          setEditPanel((prev) =>
                            checked ? [...prev, u.uid] : prev.filter((x) => x !== u.uid)
                          )
                        }
                      />
                      <label htmlFor={`ep-${u.uid}`} className="flex-1 cursor-pointer">
                        <p className="text-sm font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {ROLE_LABELS[u.role] ?? u.role}{u.department ? ` · ${u.department}` : ""}
                        </p>
                      </label>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={isSavingEdit}>
                Cancel
              </Button>
              <Button onClick={saveEdit} loading={isSavingEdit}>
                Save Changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="pt-6 space-y-5">
          {/* Batch overview */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Briefcase className="h-4 w-4 shrink-0" />
              <span><strong className="text-foreground">Department:</strong> {detailBatch?.department as string}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar className="h-4 w-4 shrink-0" />
              <span><strong className="text-foreground">Date:</strong> {formatDate(detailBatch?.interviewDate as Parameters<typeof formatDate>[0])}</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4 shrink-0" />
              <span><strong className="text-foreground">Panel:</strong> {(detailBatch?.panelMemberUids as string[] | undefined)?.length ?? 0} members</span>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="h-4 w-4 shrink-0" />
              <span><strong className="text-foreground">Candidates:</strong> {detailCandidates.length}</span>
            </div>
          </div>

          {/* Candidates */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              Candidates
            </p>
            {loadingCandidates ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : detailCandidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates found for this batch.</p>
            ) : (
              <div className="space-y-2">
                {detailCandidates.map((c) => (
                  <div key={c.id} className="border rounded-lg p-3 space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.email} · {c.phone}</p>
                        <p className="text-xs text-muted-foreground">{c.position} · {c.department}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-xs">
                          {c.source === "CAREERS_PAGE" ? "Careers Page" : c.source === "REFERRAL" ? "Referral" : c.source}
                        </Badge>
                        <StatusBadge status={c.status} />
                      </div>
                    </div>
                    {c.resumeUrl ? (
                      <a
                        href={c.resumeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        View Resume
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground/60">No resume uploaded</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Principal notes */}
          {detailBatch?.principalNotes ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Principal Notes</p>
              <p className="text-sm bg-muted/50 rounded p-2">{detailBatch.principalNotes as string}</p>
            </div>
          ) : null}

          {/* Action section — only for PENDING */}
          {isPending && (
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={action === "approve" ? "default" : "outline"}
                  onClick={() => setAction("approve")}
                >Approve</Button>
                <Button
                  size="sm"
                  variant={action === "reject" ? "destructive" : "outline"}
                  onClick={() => setAction("reject")}
                  className={action !== "reject" ? "text-destructive border-destructive hover:bg-destructive/10" : ""}
                >Reject</Button>
              </div>

              {action === "reject" && (
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason for rejection..."
                    rows={3}
                  />
                </div>
              )}
            </div>
          )}

          {isPending && action && (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button variant="outline" onClick={() => setAction(null)} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant={action === "reject" ? "destructive" : "default"}
                onClick={handleAction}
                loading={loading}
              >
                {action === "approve" ? "Approve Plan" : "Reject Plan"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={action === "approve" && !!detailBatch && !detailCandidates.length && !loadingCandidates}
        onOpenChange={(open) => { if (!open) { setAction(null); } }}
        title="Approve Interview Plan?"
        description={`Approve the interview plan for ${detailBatch?.position as string ?? ""} in ${detailBatch?.department as string ?? ""}?`}
        confirmLabel="Approve"
        onConfirm={handleAction}
        loading={loading}
      />
    </div>
  );
}
