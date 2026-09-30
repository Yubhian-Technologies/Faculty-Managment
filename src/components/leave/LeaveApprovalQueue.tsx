"use client";

import { useEffect, useState, useCallback } from "react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Avatar } from "@/components/shared/Avatar";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { PermissionApprovalQueue } from "@/components/leave/PermissionApprovalQueue";
import { PeriodCoverageGrid, type PeriodCoverageEntry } from "@/components/leave/PeriodCoverageGrid";
import { cn, formatDate, formatTime12h } from "@/lib/utils";
import { CalendarClock, Check, X, ChevronDown, ChevronUp, FileCheck, BellRing } from "lucide-react";
import { EFFECTIVE_CATEGORY_LABELS, EFFECTIVE_CATEGORY_ORDER, LEAVE_TYPE_LABELS, OTHER_LEAVE_CATEGORY_DESCRIPTIONS, OTHER_LEAVE_CATEGORY_LABELS, OTHER_LEAVE_CATEGORY_ORDER } from "@/types/leave";
import type { EffectiveLeaveCategory, LeaveRequest, OtherLeaveCategory } from "@/types/leave";

const CATEGORY_TABS = EFFECTIVE_CATEGORY_ORDER.map((key) => ({ key, label: EFFECTIVE_CATEGORY_LABELS[key] }));

// "Replacement" mode needs ONE faculty member who is actually free for every
// affected period, not just some of them - each period's own eligibility
// list (buildPeriodCoverage) already excludes anyone busy or on leave for
// that specific day/period, so the only faculty safe to assign across the
// whole leave are the ones appearing in ALL of them.
function intersectCandidates(periods: PeriodCoverageEntry[]): { facultyId: string; facultyName: string; facultyDepartment?: string }[] {
  if (periods.length === 0) return [];
  let ids: Set<string> = new Set(periods[0].candidates.map((c) => c.facultyId));
  const nameById = new Map<string, string>();
  for (const p of periods) {
    const periodIds = new Set(p.candidates.map((c) => c.facultyId));
    for (const c of p.candidates) nameById.set(c.facultyId, c.facultyName);
    ids = new Set(Array.from(ids).filter((id) => periodIds.has(id)));
    if (ids.size === 0) break;
  }
  return Array.from(ids)
    .map((id) => ({ facultyId: id, facultyName: nameById.get(id) ?? id }))
    .sort((a, b) => a.facultyName.localeCompare(b.facultyName));
}

// Shared by /hod/leave-approvals (department queue) and /principal/leave-approvals
// (college-wide final sign-off) - the API scopes the results server-side.
//
// Standard types (CL/SL/SCL/EL/OD) only ever appear in the HOD's queue - the
// HOD's decision there is final. "Other" requests can appear in either queue:
// the HOD tags paid/unpaid and forwards (status still PENDING_HOD here), the
// Principal then sees that tag read-only and gives the real final decision
// (status PENDING_PRINCIPAL).
export function LeaveApprovalQueue() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [remarksById, setRemarksById] = useState<Record<string, string>>({});
  const [paidById, setPaidById] = useState<Record<string, boolean>>({});
  const [categoryById, setCategoryById] = useState<Record<string, OtherLeaveCategory>>({});
  const [actingId, setActingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [category, setCategory] = useState<EffectiveLeaveCategory>("vacation");
  // HOD-only: optional period adjustment shown while forwarding an "Other"
  // request (see PeriodSubstitution in types/leave.ts) - keyed by request id.
  const [periodsById, setPeriodsById] = useState<Record<string, PeriodCoverageEntry[]>>({});
  const [loadingPeriodsId, setLoadingPeriodsId] = useState<string | null>(null);
  const [substitutionsById, setSubstitutionsById] = useState<Record<string, Record<string, string>>>({});
  // "Adjustment" (default) = the existing per-period picker below. "Replacement"
  // = one faculty member covers every affected period for the whole leave -
  // see intersectCandidates above.
  const [coverageModeById, setCoverageModeById] = useState<Record<string, "ADJUSTMENT" | "REPLACEMENT">>({});
  const [replacementFacultyById, setReplacementFacultyById] = useState<Record<string, string>>({});

  // On Duty proof submissions awaiting this approver - see the section below
  // the main queue.
  const [odProofs, setOdProofs] = useState<LeaveRequest[]>([]);
  const [odProofReasonById, setOdProofReasonById] = useState<Record<string, string>>({});
  const [odProofActingId, setOdProofActingId] = useState<string | null>(null);

  // Approved On Duty leaves with nothing uploaded yet (never submitted, or
  // rejected and not fixed) - see the section below the proof-verification
  // one. Separate list from odProofs above: that one is "review what's been
  // uploaded", this one is "chase what hasn't".
  const [odMissingProofs, setOdMissingProofs] = useState<LeaveRequest[]>([]);
  const [odRequestingId, setOdRequestingId] = useState<string | null>(null);
  const [odRequestedIds, setOdRequestedIds] = useState<Set<string>>(new Set());

  // Post-leave certificate submissions (SL or SCL) awaiting this approver -
  // never affects pay either way (see lib/leave/leaveCertificate.ts).
  const [certificates, setCertificates] = useState<LeaveRequest[]>([]);
  const [certificateReasonById, setCertificateReasonById] = useState<Record<string, string>>({});
  const [certificateActingId, setCertificateActingId] = useState<string | null>(null);

  // Approved SCLs whose period has ended with no certificate on file yet -
  // SL is never chased here, its certificate is purely optional.
  const [missingCertificates, setMissingCertificates] = useState<LeaveRequest[]>([]);
  const [certificateRequestingId, setCertificateRequestingId] = useState<string | null>(null);
  const [certificateRequestedIds, setCertificateRequestedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/leave/applications?scope=approvals");
      const data = (await res.json()) as { requests?: LeaveRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load approvals");
      setRequests(data.requests ?? []);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load approvals" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Approved On Duty leaves whose proof of duty is waiting on this approver.
  // A separate fetch because these are APPROVED - `scope=approvals` only ever
  // returns PENDING_* requests, so they could never arrive through it.
  const loadOdProofs = useCallback(async () => {
    try {
      const res = await fetch("/api/leave/applications?scope=od-proofs");
      const data = (await res.json()) as { requests?: LeaveRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load proof submissions");
      setOdProofs(data.requests ?? []);
    } catch {
      // Deliberately quiet: the pending-approvals queue above is the primary
      // job of this screen and must still render if this secondary list fails.
      setOdProofs([]);
    }
  }, []);

  const loadOdMissingProofs = useCallback(async () => {
    try {
      const res = await fetch("/api/leave/applications?scope=od-missing-proof");
      const data = (await res.json()) as { requests?: LeaveRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load missing-proof list");
      setOdMissingProofs(data.requests ?? []);
    } catch {
      // Deliberately quiet - same reasoning as loadOdProofs above.
      setOdMissingProofs([]);
    }
  }, []);

  const loadCertificates = useCallback(async () => {
    try {
      const res = await fetch("/api/leave/applications?scope=leave-certificates");
      const data = (await res.json()) as { requests?: LeaveRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load certificate submissions");
      setCertificates(data.requests ?? []);
    } catch {
      // Deliberately quiet - same reasoning as loadOdProofs above.
      setCertificates([]);
    }
  }, []);

  const loadMissingCertificates = useCallback(async () => {
    try {
      const res = await fetch("/api/leave/applications?scope=scl-missing-certificate");
      const data = (await res.json()) as { requests?: LeaveRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load missing-certificate list");
      setMissingCertificates(data.requests ?? []);
    } catch {
      // Deliberately quiet - same reasoning as loadOdProofs above.
      setMissingCertificates([]);
    }
  }, []);

  async function requestCertificate(request: LeaveRequest) {
    setCertificateRequestingId(request.id);
    try {
      const res = await fetch(`/api/leave/applications/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REQUEST_CERTIFICATE" }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to send the request");
      toast({ variant: "success", title: `${request.employeeName} has been notified` });
      setCertificateRequestedIds((prev) => new Set(prev).add(request.id));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to send the request" });
    } finally {
      setCertificateRequestingId(null);
    }
  }

  async function reviewCertificate(request: LeaveRequest, verify: boolean) {
    const reason = (certificateReasonById[request.id] ?? "").trim();
    if (!verify && !reason) {
      toast({ variant: "destructive", title: "Add a reason so they know what to fix" });
      return;
    }
    setCertificateActingId(request.id);
    try {
      const res = await fetch(`/api/leave/applications/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: verify ? "VERIFY_CERTIFICATE" : "REJECT_CERTIFICATE",
          ...(verify ? {} : { reason }),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to record the decision");
      toast({
        variant: "success",
        title: verify ? "Certificate verified" : "Certificate rejected",
        description: verify
          ? `${request.employeeName}'s certificate is now on file as verified.`
          : `${request.employeeName} has been asked to re-upload.`,
      });
      setCertificates((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to record the decision" });
    } finally {
      setCertificateActingId(null);
    }
  }

  async function requestOdProof(request: LeaveRequest) {
    setOdRequestingId(request.id);
    try {
      const res = await fetch(`/api/leave/applications/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REQUEST_OD_PROOF" }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to send the request");
      toast({ variant: "success", title: `${request.employeeName} has been notified` });
      setOdRequestedIds((prev) => new Set(prev).add(request.id));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to send the request" });
    } finally {
      setOdRequestingId(null);
    }
  }

  async function reviewOdProof(request: LeaveRequest, verify: boolean) {
    const reason = (odProofReasonById[request.id] ?? "").trim();
    if (!verify && !reason) {
      toast({ variant: "destructive", title: "Add a reason so they know what to fix" });
      return;
    }
    setOdProofActingId(request.id);
    try {
      const res = await fetch(`/api/leave/applications/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: verify ? "VERIFY_OD_PROOF" : "REJECT_OD_PROOF",
          ...(verify ? {} : { reason }),
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to record the decision");
      toast({
        variant: "success",
        title: verify ? "Proof verified" : "Proof rejected",
        description: verify
          ? `${request.employeeName}'s On Duty days remain paid.`
          : `${request.employeeName} has been asked to re-upload.`,
      });
      setOdProofs((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to record the decision" });
    } finally {
      setOdProofActingId(null);
    }
  }

  useEffect(() => {
    load();
    // Fetched alongside the pending queue rather than from its own effect -
    // five independent lists, but one mount-time load.
    loadOdProofs();
    loadOdMissingProofs();
    loadCertificates();
    loadMissingCertificates();
  }, [load, loadOdProofs, loadOdMissingProofs, loadCertificates, loadMissingCertificates]);

  useEffect(() => {
    if (!expandedId) return;
    const r = requests.find((req) => req.id === expandedId);
    // Both standard types (CL/SL/...) and "Other" requests reach here now -
    // a standard type already has the requester's own picks from
    // submission (mode: "FULL" in applications/route.ts POST), which get
    // seeded into substitutionsById below so the HOD only has to touch
    // what actually needs changing instead of re-picking from scratch.
    const isPendingHod = !!r && r.status === "PENDING_HOD";
    if (!isPendingHod || periodsById[expandedId]) return;
    setLoadingPeriodsId(expandedId);
    fetch(`/api/leave/period-coverage?requestId=${expandedId}`)
      .then((res) => res.json() as Promise<{ periods?: PeriodCoverageEntry[] }>)
      .then((data) => {
        setPeriodsById((prev) => ({ ...prev, [expandedId]: data.periods ?? [] }));
        // Pending coverage is seeded alongside committed, so a substitute the
        // approver already named still shows as chosen when they come back to
        // forward the request.
        const onRecord = [...(r!.periodSubstitutions ?? []), ...(r!.pendingPeriodSubstitutions ?? [])];
        if (onRecord.length) {
          const seeded: Record<string, string> = {};
          for (const p of onRecord) seeded[`${p.date}|${p.timetableSlotId}`] = p.substituteFacultyId;
          setSubstitutionsById((prev) => ({ ...prev, [expandedId]: { ...seeded, ...(prev[expandedId] ?? {}) } }));
          // One person covering every affected period is what Replacement
          // means - reflect that back into its picker when it is the case.
          const ids = new Set(onRecord.map((p) => p.substituteFacultyId));
          if (ids.size === 1 && (r!.pendingPeriodSubstitutions?.length ?? 0) > 0) {
            const only = [...ids][0];
            setReplacementFacultyById((prev) => ({ ...prev, [expandedId]: prev[expandedId] ?? only }));
          }
        }
      })
      .catch(() => setPeriodsById((prev) => ({ ...prev, [expandedId]: [] })))
      .finally(() => setLoadingPeriodsId((prev) => (prev === expandedId ? null : prev)));
  }, [expandedId, requests, periodsById]);

  // Whether this HOD has named coverage that isn't already on the request -
  // the same comparison PROPOSE_COVERAGE makes server-side (see the `changed`
  // filter in applications/[id]/route.ts). Picks are seeded from the
  // requester's own submission above, so "the HOD touched something" can't be
  // inferred from the picks being non-empty; they have to be compared.
  function hasNewCoverage(r: LeaveRequest): boolean {
    const periods = periodsById[r.id] ?? [];
    if (periods.length === 0) return false;
    // Committed coverage AND coverage already sent and awaiting acceptance -
    // both count as "on record", so re-opening the request after sending an
    // adjustment request doesn't offer to send the same one again.
    const onRecord = new Map(
      [...(r.periodSubstitutions ?? []), ...(r.pendingPeriodSubstitutions ?? [])]
        .map((p) => [`${p.date}|${p.timetableSlotId}`, p.substituteFacultyId])
    );
    if ((coverageModeById[r.id] ?? "ADJUSTMENT") === "REPLACEMENT") {
      const replacement = replacementFacultyById[r.id];
      if (!replacement) return false;
      return periods.some((p) => onRecord.get(`${p.date}|${p.timetableSlotId}`) !== replacement);
    }
    return Object.entries(substitutionsById[r.id] ?? {}).some(([key, id]) => id && onRecord.get(key) !== id);
  }

  async function act(r: LeaveRequest, action: "APPROVE" | "REJECT") {
    const isPendingHod = r.status === "PENDING_HOD";
    const isHodOtherDecision = isPendingHod && !!r.isOtherRequest;
    // PENDING_PRINCIPAL: a Vice Principal's own Other leave, which skips the
    // HOD stage entirely and reaches here still untagged - the Principal
    // decides it themselves, in the same Approve action. PENDING_VICE_PRINCIPAL:
    // an HOD-forwarded Other request (already tagged paid/unpaid by the HOD).
    const isPrincipalOtherDecision = (r.status === "PENDING_PRINCIPAL" || r.status === "PENDING_VICE_PRINCIPAL") && !!r.isOtherRequest;
    const needsPaidLeaveDecision = !!r.isOtherRequest && r.isPaidLeave === undefined && (isHodOtherDecision || isPrincipalOtherDecision);
    if (action === "APPROVE" && needsPaidLeaveDecision && (paidById[r.id] ?? r.isPaidLeave) === undefined) {
      toast({ variant: "destructive", title: "Select whether this is paid or unpaid leave" });
      return;
    }
    if (action === "APPROVE" && isPrincipalOtherDecision && categoryById[r.id] === undefined) {
      toast({ variant: "destructive", title: "Select a leave category before approving" });
      return;
    }
    setActingId(r.id);
    try {
      const mode = coverageModeById[r.id] ?? "ADJUSTMENT";
      const periods = periodsById[r.id] ?? [];
      const picks = substitutionsById[r.id] ?? {};
      const replacementFacultyId = replacementFacultyById[r.id];
      // Sent for ANY PENDING_HOD decision now, not just "Other" - a standard
      // type's picks are pre-filled from the requester's own submission (see
      // the periods-fetch effect above), so approving without touching
      // anything still resubmits them unchanged; the server-side merge in
      // applications/[id]/route.ts only overrides the periods actually
      // included here, same as an explicit HOD adjustment.
      const periodSubstitutions =
        action !== "APPROVE" || !isPendingHod
          ? undefined
          : mode === "REPLACEMENT"
            ? replacementFacultyId && periods.length > 0
              ? periods.map((p) => ({
                  date: p.date,
                  timetableSlotId: p.timetableSlotId,
                  substituteFacultyId: replacementFacultyId,
                }))
              : undefined
            : Object.keys(picks).length > 0
              ? periods
                  .filter((p) => picks[`${p.date}|${p.timetableSlotId}`])
                  .map((p) => ({
                    date: p.date,
                    timetableSlotId: p.timetableSlotId,
                    substituteFacultyId: picks[`${p.date}|${p.timetableSlotId}`],
                  }))
              : undefined;
      // A period pick that's actually NEW/CHANGED here needs that substitute's
      // own acceptance before this can go any further - see
      // PROPOSE_COVERAGE in applications/[id]/route.ts. Sent as a separate
      // call first: if it finds nothing genuinely new (everything already
      // matches what's on record, e.g. the requester's own unchanged picks),
      // the follow-up APPROVE/forward below proceeds immediately, same as
      // before. If it does find changes, APPROVE is rejected with a clear
      // "awaiting acceptance" error instead of silently going through.
      if (periodSubstitutions?.length) {
        const proposeRes = await fetch(`/api/leave/applications/${r.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "PROPOSE_COVERAGE",
            periodSubstitutions,
            // Persisted now rather than only on APPROVE: the approver leaves
            // this form until the substitute accepts, and would otherwise have
            // to pick paid/unpaid again on return.
            ...(typeof paidById[r.id] === "boolean" ? { isPaidLeave: paidById[r.id] } : {}),
          }),
        });
        const proposeData = (await proposeRes.json()) as { error?: string; changed?: boolean };
        if (!proposeRes.ok) throw new Error(proposeData.error ?? "Failed to update coverage");
        // Naming someone new is its own step: they have to accept before this
        // can go to the Principal. Stop here rather than attempting the
        // forward, which the server would reject anyway ("still awaiting
        // acceptance") - that read as a failure when it was the flow working.
        if (proposeData.changed) {
          toast({
            variant: "success",
            title: "Adjustment request sent",
            description: "Forward to the Principal once they accept - track it under Leave Approvals.",
          });
          setActingId(null);
          void load();
          return;
        }
      }

      const res = await fetch(`/api/leave/applications/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          remarks: remarksById[r.id],
          isPaidLeave: r.isOtherRequest ? (paidById[r.id] ?? r.isPaidLeave) : undefined,
          otherLeaveCategory: isPrincipalOtherDecision ? categoryById[r.id] : undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed");
      toast({
        variant: "success",
        title: action === "REJECT" ? "Request rejected" : isHodOtherDecision ? "Forwarded to Principal" : "Request approved",
      });
      setRequests((prev) => prev.filter((req) => req.id !== r.id));
      setExpandedId((prev) => (prev === r.id ? null : prev));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Action failed" });
      // A PROPOSE_COVERAGE that found real changes leaves this request with a
      // new pending acceptance even though the APPROVE call right after it
      // failed - reload so the queue reflects that instead of showing stale
      // picks that look like nothing happened.
      void load();
    } finally {
      setActingId(null);
    }
  }

  const visibleRequests = requests.filter((r) => r.category === category);

  return (
    <div className="space-y-4">
      <SegmentedTabs value={category} onChange={(key) => setCategory(key as EffectiveLeaveCategory)} options={CATEGORY_TABS} />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : visibleRequests.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-6 w-6" />}
          title={requests.length === 0 ? "No pending leave requests" : `No pending requests from ${EFFECTIVE_CATEGORY_LABELS[category]}`}
        />
      ) : (
        <div className="space-y-2.5">
          {visibleRequests.map((r) => {
            const isOtherRequest = !!r.isOtherRequest;
            const isPendingHod = r.status === "PENDING_HOD";
            const isHodOtherDecision = isPendingHod && isOtherRequest;
            const isPrincipalOtherDecision = (r.status === "PENDING_PRINCIPAL" || r.status === "PENDING_VICE_PRINCIPAL") && isOtherRequest;
            const isExpanded = expandedId === r.id;
            return (
              <Card key={r.id} className={cn("transition-colors", isExpanded && "ring-1 ring-primary/20")}>
                <CardHeader
                  className="p-4 cursor-pointer select-none"
                  onClick={() => setExpandedId(isExpanded ? null : r.id)}
                >
                  <div className="flex items-center gap-3">
                    <Avatar name={r.employeeName} size="sm" />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold leading-tight">{r.employeeName}</p>
                        {r.department && (
                          <Badge variant="outline" className="capitalize text-[10px] px-1.5 py-0">
                            {r.department}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground truncate">
                        {formatDate(r.fromDate)} - {formatDate(r.toDate)} &middot; {r.totalDays} day{r.totalDays === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary">
                        {isOtherRequest ? "Other" : LEAVE_TYPE_LABELS[r.leaveTypeCode!]}
                      </Badge>
                      {r.isHalfDay && (
                        <Badge variant="outline">Half Day &middot; {r.halfDaySession === "AN" ? "Afternoon" : "Forenoon"}</Badge>
                      )}
                      {r.extendsRequestId && (
                        <Badge variant="outline" title="This extends a leave that was already approved">
                          Extension
                        </Badge>
                      )}
                      {isOtherRequest && !isHodOtherDecision && r.isPaidLeave !== undefined && (
                        <Badge variant={r.isPaidLeave ? "approved" : "modified"}>
                          {r.isPaidLeave ? "Paid" : "Unpaid"}
                        </Badge>
                      )}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="px-4 pb-4 pt-0 space-y-3 border-t">
                    <div className="space-y-1.5 pt-3">
                      <label className="text-xs text-muted-foreground">Reason</label>
                      <p className="text-sm">{r.reason || <span className="text-muted-foreground italic">No reason provided</span>}</p>
                      {r.proofRoutedTo === "EXAM_CELL" && (
                        <Badge variant="secondary" className="text-[10px]">Proof goes to Exam Cell</Badge>
                      )}
                    </div>

                    {(r.placeOfVisit || r.pointOfContact) && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Place{r.leaveTypeCode === "OD" ? " of Visit" : ""}</label>
                          <p className="text-sm">{r.placeOfVisit || "—"}</p>
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-muted-foreground">Point of Contact</label>
                          <p className="text-sm">{r.pointOfContact || "—"}</p>
                        </div>
                      </div>
                    )}

                    {/* SCL's mandatory apply-time evidence - attached at
                        submission, distinct from the post-leave certificate
                        flow (see the "Certificate Verification" section
                        below, which only covers APPROVED requests). */}
                    {r.applyProofUrl && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Supporting Evidence</label>
                        <p className="text-sm">
                          <a
                            href={r.applyProofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline"
                          >
                            View attached proof
                          </a>
                        </p>
                      </div>
                    )}

                    {isOtherRequest && (isHodOtherDecision || isPrincipalOtherDecision) && (
                      <div className="max-w-xs space-y-1.5">
                        <label className="text-xs text-muted-foreground">Paid or unpaid?</label>
                        <Select
                          value={(paidById[r.id] ?? r.isPaidLeave) === undefined ? "" : String(paidById[r.id] ?? r.isPaidLeave)}
                          onValueChange={(v) => setPaidById((prev) => ({ ...prev, [r.id]: v === "true" }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select paid or unpaid" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="true">Paid</SelectItem>
                            <SelectItem value="false">Unpaid</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {isPendingHod && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <label className="text-xs text-muted-foreground">
                            {isOtherRequest ? "Adjust / replace periods (optional)" : `Coverage - arranged by ${r.employeeName}, adjustable`}
                          </label>
                          {(periodsById[r.id]?.length ?? 0) > 0 && (
                            <SegmentedTabs
                              value={coverageModeById[r.id] ?? "ADJUSTMENT"}
                              onChange={(v) =>
                                setCoverageModeById((prev) => ({ ...prev, [r.id]: v as "ADJUSTMENT" | "REPLACEMENT" }))
                              }
                              options={[
                                { key: "ADJUSTMENT", label: "Adjustment" },
                                { key: "REPLACEMENT", label: "Replacement" },
                              ]}
                            />
                          )}
                        </div>
                        {loadingPeriodsId === r.id ? (
                          <div className="h-12 bg-muted animate-pulse rounded-lg" />
                        ) : (periodsById[r.id]?.length ?? 0) === 0 ? (
                          <p className="text-xs text-muted-foreground italic">No teaching periods fall within this leave range.</p>
                        ) : (coverageModeById[r.id] ?? "ADJUSTMENT") === "REPLACEMENT" ? (
                          (() => {
                            const replacementCandidates = intersectCandidates(periodsById[r.id]!);
                            return (
                              <div className="rounded-lg border p-2.5 space-y-2">
                                <p className="text-xs text-muted-foreground">
                                  One faculty member covers all {periodsById[r.id]!.length} affected period{periodsById[r.id]!.length === 1 ? "" : "s"} for the entire leave.
                                </p>
                                <Select
                                  value={replacementFacultyById[r.id] ?? ""}
                                  onValueChange={(v) => setReplacementFacultyById((prev) => ({ ...prev, [r.id]: v }))}
                                >
                                  <SelectTrigger className="w-56">
                                    <SelectValue placeholder={replacementCandidates.length ? "Select replacement faculty" : "No one is free for every period"} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {replacementCandidates.map((c) => (
                                      <SelectItem key={c.facultyId} value={c.facultyId}>
                          {c.facultyName}
                          {c.facultyDepartment && (
                            <span className="text-muted-foreground"> · {c.facultyDepartment}</span>
                          )}
                        </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                {replacementCandidates.length === 0 && (
                                  <p className="text-xs text-destructive">
                                    No single faculty is free for every affected period - switch to Adjustment to cover periods individually.
                                  </p>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <div className="rounded-lg border p-2.5">
                            <PeriodCoverageGrid
                              periods={periodsById[r.id]!}
                              renderPeriod={(p, key) => (
                                <div key={key} className="space-y-1 rounded-md border p-2">
                                  <p className="text-xs font-medium leading-tight">Period {p.periodNumber}</p>
                                  <p className="text-xs leading-tight">
                                    {p.subjectName}{p.sectionName ? ` · ${p.sectionName}` : ""}
                                  </p>
                                  {p.startTime && p.endTime && (
                                    <p className="text-xs text-muted-foreground leading-tight">
                                      {formatTime12h(p.startTime)}&ndash;{formatTime12h(p.endTime)}
                                    </p>
                                  )}
                                  <Select
                                    value={substitutionsById[r.id]?.[key] ?? ""}
                                    onValueChange={(v) =>
                                      setSubstitutionsById((prev) => ({
                                        ...prev,
                                        [r.id]: { ...(prev[r.id] ?? {}), [key]: v },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="w-full">
                                      <SelectValue placeholder="Not covered" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {p.candidates.map((c) => (
                                        <SelectItem key={c.facultyId} value={c.facultyId}>
                                          {c.facultyName}
                                          {c.facultyDepartment && (
                                            <span className="text-muted-foreground"> · {c.facultyDepartment}</span>
                                          )}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              )}
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {isPrincipalOtherDecision && (
                      <div className="space-y-1.5">
                        <div className="max-w-xs space-y-1.5">
                        <label className="text-xs text-muted-foreground">Leave category (required to approve)</label>
                        <Select
                          value={categoryById[r.id] ?? ""}
                          onValueChange={(v) => setCategoryById((prev) => ({ ...prev, [r.id]: v as OtherLeaveCategory }))}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select category" />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Maternity only for female staff with at least
                                1 completed year of service - the server
                                rejects it otherwise regardless (see the
                                APPROVE guard in applications/[id]), so this
                                keeps the picker from offering a choice that
                                can't be saved. Requesters with no gender on
                                record don't get it either. */}
                            {OTHER_LEAVE_CATEGORY_ORDER
                              .filter((c) => c !== "MATERNITY" || (r.requesterGender === "Female" && r.requesterHasOneYearService))
                              .map((c) => (
                                <SelectItem key={c} value={c}>{OTHER_LEAVE_CATEGORY_LABELS[c]}</SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">Only visible in your own Staff Leave History - never shown to the requester, their HOD, or anyone else.</p>
                        </div>
                        {/* The selected category's own rule (duration limits,
                            certificate/service conditions), so the sanctioning
                            terms are in front of the Principal at the moment of
                            the decision. Nothing is enforced from it - Other
                            requests aren't balance-tracked.
                            Deliberately OUTSIDE the max-w-xs wrapper above: at
                            the select's width these rules wrapped to three or
                            four lines, so it takes the card's full width and
                            reads as one. */}
                        {categoryById[r.id] && OTHER_LEAVE_CATEGORY_DESCRIPTIONS[categoryById[r.id] as OtherLeaveCategory] && (
                          <p className="text-xs text-amber-900 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
                            {OTHER_LEAVE_CATEGORY_DESCRIPTIONS[categoryById[r.id] as OtherLeaveCategory]}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-xs text-muted-foreground">Remarks (optional)</label>
                      <Textarea
                        placeholder="Add a note for this decision..."
                        rows={2}
                        className="resize-none text-sm"
                        value={remarksById[r.id] ?? ""}
                        onChange={(e) => setRemarksById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                      />
                    </div>

                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={actingId === r.id}
                        onClick={() => act(r, "REJECT")}
                      >
                        <X className="h-4 w-4 mr-1" /> Reject
                      </Button>
                      <Button size="sm" disabled={actingId === r.id} onClick={() => act(r, "APPROVE")}>
                        <Check className="h-4 w-4 mr-1" /> {hasNewCoverage(r)
                          ? "Send Adjustment Request"
                          : isHodOtherDecision ? "Forward to Principal" : "Approve"}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Proof of duty for leaves that are ALREADY approved - a separate list,
          not another tab, because the tab strip above is spent on the
          new-joining/vacation/non-vacation split and these rows aren't part of
          that dimension. Renders nothing at all when there's none outstanding. */}
      {odProofs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">On Duty Proof Verification ({odProofs.length})</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            On Duty leave is only paid once the duty is evidenced. Verify the document, or reject it with a reason so
            they can re-upload.
          </p>
          {odProofs.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={r.employeeName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{r.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(r.fromDate)} – {formatDate(r.toDate)} · {r.totalDays} day
                        {r.totalDays === 1 ? "" : "s"}
                        {r.department ? ` · ${r.department}` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge variant="pending" className="shrink-0">On Duty</Badge>
                </div>

                {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}

                {r.applyProofUrl && (
                  <a
                    href={r.applyProofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <FileCheck className="h-3.5 w-3.5" /> View document attached at apply time
                  </a>
                )}

                {r.odProofUrl && (
                  <a
                    href={r.odProofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <FileCheck className="h-3.5 w-3.5" /> View proof of duty
                  </a>
                )}

                <div>
                  <label className="text-xs font-medium">Reason (required to reject)</label>
                  <Textarea
                    className="mt-1 text-xs"
                    rows={2}
                    placeholder="e.g. the certificate doesn't cover these dates"
                    value={odProofReasonById[r.id] ?? ""}
                    onChange={(e) => setOdProofReasonById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={odProofActingId === r.id}
                    onClick={() => void reviewOdProof(r, false)}
                  >
                    <X className="h-4 w-4 mr-1" /> Reject
                  </Button>
                  <Button size="sm" disabled={odProofActingId === r.id} onClick={() => void reviewOdProof(r, true)}>
                    <Check className="h-4 w-4 mr-1" /> Verify
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Approved On Duty leaves whose requester hasn't uploaded proof at all
          (or was rejected and hasn't fixed it) - separate from the
          verification list above, which is only ever "review what's already
          been uploaded". The system already reminds them automatically 24h
          after their period ends (see api/cron/od-proof-reminders); this is
          for chasing it further, not the only way it happens. */}
      {odMissingProofs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">On Duty Proof Not Uploaded ({odMissingProofs.length})</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These On Duty leaves have ended with no proof of duty on file yet. They&rsquo;ve already had (or will get) an
            automatic reminder - send one yourself if it&rsquo;s still overdue.
          </p>
          <div className="divide-y rounded-lg border">
            {odMissingProofs.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={r.employeeName} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{r.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.fromDate)} – {formatDate(r.toDate)}
                      {r.department ? ` · ${r.department}` : ""}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={odRequestingId === r.id || odRequestedIds.has(r.id)}
                  onClick={() => void requestOdProof(r)}
                >
                  <BellRing className="h-4 w-4 mr-1" />
                  {odRequestedIds.has(r.id) ? "Requested" : "Request Upload"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Post-leave certificates (SL or SCL) awaiting review - never affects
          whether the leave is paid, for either type. */}
      {certificates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Certificate Verification ({certificates.length})</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These never affect whether the leave is paid - verify the document, or reject it with a reason so they can
            re-upload.
          </p>
          {certificates.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={r.employeeName} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium leading-tight">{r.employeeName}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDate(r.fromDate)} – {formatDate(r.toDate)} · {r.totalDays} day
                        {r.totalDays === 1 ? "" : "s"}
                        {r.department ? ` · ${r.department}` : ""}
                      </p>
                    </div>
                  </div>
                  <Badge variant="pending" className="shrink-0">
                    {r.leaveTypeCode ? LEAVE_TYPE_LABELS[r.leaveTypeCode] : "Leave"}
                  </Badge>
                </div>

                {r.reason && <p className="text-xs text-muted-foreground">{r.reason}</p>}

                {r.applyProofUrl && (
                  <a
                    href={r.applyProofUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <FileCheck className="h-3.5 w-3.5" /> View document attached at apply time
                  </a>
                )}

                {r.certificateUrl && (
                  <a
                    href={r.certificateUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <FileCheck className="h-3.5 w-3.5" /> View certificate
                  </a>
                )}

                <div>
                  <label className="text-xs font-medium">Reason (required to reject)</label>
                  <Textarea
                    className="mt-1 text-xs"
                    rows={2}
                    placeholder="e.g. the certificate doesn't cover these dates"
                    value={certificateReasonById[r.id] ?? ""}
                    onChange={(e) => setCertificateReasonById((prev) => ({ ...prev, [r.id]: e.target.value }))}
                  />
                </div>

                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={certificateActingId === r.id}
                    onClick={() => void reviewCertificate(r, false)}
                  >
                    <X className="h-4 w-4 mr-1" /> Reject
                  </Button>
                  <Button size="sm" disabled={certificateActingId === r.id} onClick={() => void reviewCertificate(r, true)}>
                    <Check className="h-4 w-4 mr-1" /> Verify
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Approved SCLs whose period has ended with no certificate on file yet
          (never uploaded, or rejected and not fixed) - SL never appears here,
          its certificate is purely optional. Same shape as the On Duty
          missing-proof list above, minus any pay consequence. */}
      {missingCertificates.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Certificate Not Uploaded ({missingCertificates.length})</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            These Special Casual Leaves have ended with no certificate on file yet. This never affects whether the
            leave is paid - send a reminder if you&rsquo;d like one on record.
          </p>
          <div className="divide-y rounded-lg border">
            {missingCertificates.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 p-3 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={r.employeeName} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{r.employeeName}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(r.fromDate)} – {formatDate(r.toDate)}
                      {r.department ? ` · ${r.department}` : ""}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={certificateRequestingId === r.id || certificateRequestedIds.has(r.id)}
                  onClick={() => void requestCertificate(r)}
                >
                  <BellRing className="h-4 w-4 mr-1" />
                  {certificateRequestedIds.has(r.id) ? "Requested" : "Request Upload"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Late-attendance permissions routed to this approver. Renders nothing
          when there are none, so the page is unchanged for anyone with an
          empty queue. */}
      <PermissionApprovalQueue />
    </div>
  );
}
