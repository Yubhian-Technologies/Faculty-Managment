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
import { cn, formatDate } from "@/lib/utils";
import { CalendarClock, Check, X, ChevronDown, ChevronUp, Users } from "lucide-react";
import { EFFECTIVE_CATEGORY_LABELS, EFFECTIVE_CATEGORY_ORDER, LEAVE_TYPE_LABELS, OTHER_LEAVE_CATEGORY_LABELS, OTHER_LEAVE_CATEGORY_ORDER } from "@/types/leave";
import type { EffectiveLeaveCategory, LeaveRequest, OtherLeaveCategory } from "@/types/leave";

const CATEGORY_TABS = EFFECTIVE_CATEGORY_ORDER.map((key) => ({ key, label: EFFECTIVE_CATEGORY_LABELS[key] }));

interface PeriodCoverageEntry {
  date: string;
  day: string;
  periodNumber: number;
  timetableSlotId: string;
  sectionName?: string;
  subjectName: string;
  candidates: { facultyId: string; facultyName: string }[];
}

// "Replacement" mode needs ONE faculty member who is actually free for every
// affected period, not just some of them - each period's own eligibility
// list (buildPeriodCoverage) already excludes anyone busy or on leave for
// that specific day/period, so the only faculty safe to assign across the
// whole leave are the ones appearing in ALL of them.
function intersectCandidates(periods: PeriodCoverageEntry[]): { facultyId: string; facultyName: string }[] {
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

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!expandedId) return;
    const r = requests.find((req) => req.id === expandedId);
    const isHodOtherDecision = !!r && r.status === "PENDING_HOD" && !!r.isOtherRequest;
    if (!isHodOtherDecision || periodsById[expandedId]) return;
    setLoadingPeriodsId(expandedId);
    fetch(`/api/leave/period-coverage?requestId=${expandedId}`)
      .then((res) => res.json() as Promise<{ periods?: PeriodCoverageEntry[] }>)
      .then((data) => setPeriodsById((prev) => ({ ...prev, [expandedId]: data.periods ?? [] })))
      .catch(() => setPeriodsById((prev) => ({ ...prev, [expandedId]: [] })))
      .finally(() => setLoadingPeriodsId((prev) => (prev === expandedId ? null : prev)));
  }, [expandedId, requests, periodsById]);

  async function act(r: LeaveRequest, action: "APPROVE" | "REJECT") {
    const isHodOtherDecision = r.status === "PENDING_HOD" && !!r.isOtherRequest;
    const isPrincipalOtherDecision = r.status === "PENDING_PRINCIPAL" && !!r.isOtherRequest;
    // Normally an HOD already tagged paid/unpaid before forwarding here. A
    // Vice Principal's own Other leave skips the HOD stage entirely though,
    // reaching PENDING_PRINCIPAL still untagged - the Principal decides it
    // themselves, in the same Approve action.
    const needsPaidLeaveDecision = !!r.isOtherRequest && r.isPaidLeave === undefined && (isHodOtherDecision || isPrincipalOtherDecision);
    if (action === "APPROVE" && needsPaidLeaveDecision && paidById[r.id] === undefined) {
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
      const periodSubstitutions =
        action !== "APPROVE" || !isHodOtherDecision
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
      const res = await fetch(`/api/leave/applications/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          remarks: remarksById[r.id],
          isPaidLeave: needsPaidLeaveDecision ? paidById[r.id] : undefined,
          otherLeaveCategory: isPrincipalOtherDecision ? categoryById[r.id] : undefined,
          periodSubstitutions,
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
            const isHodOtherDecision = r.status === "PENDING_HOD" && isOtherRequest;
            const isPrincipalOtherDecision = r.status === "PENDING_PRINCIPAL" && isOtherRequest;
            const needsPaidLeaveDecision = isOtherRequest && r.isPaidLeave === undefined && (isHodOtherDecision || isPrincipalOtherDecision);
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
                    </div>

                    {needsPaidLeaveDecision && (
                      <div className="max-w-xs space-y-1.5">
                        <label className="text-xs text-muted-foreground">Paid or unpaid?</label>
                        <Select
                          value={paidById[r.id] === undefined ? "" : String(paidById[r.id])}
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

                    {!isOtherRequest && r.status === "PENDING_HOD" && !!r.periodSubstitutions?.length && (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-muted-foreground" />
                          <label className="text-xs text-muted-foreground">Coverage arranged by {r.employeeName}</label>
                        </div>
                        <div className="rounded-lg border p-2.5 space-y-1">
                          {r.periodSubstitutions.map((p) => (
                            <p key={`${p.date}|${p.timetableSlotId}`} className="text-sm">
                              {p.subjectName}{p.sectionName ? ` · ${p.sectionName}` : ""} · {formatDate(new Date(p.date))} P{p.periodNumber}
                              <span className="text-muted-foreground"> — covered by {p.substituteFacultyName}</span>
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {isHodOtherDecision && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <label className="text-xs text-muted-foreground">Adjust / replace periods (optional)</label>
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
                                      <SelectItem key={c.facultyId} value={c.facultyId}>{c.facultyName}</SelectItem>
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
                          <div className="space-y-2 rounded-lg border p-2.5">
                            {periodsById[r.id]!.map((p) => {
                              const key = `${p.date}|${p.timetableSlotId}`;
                              return (
                                <div key={key} className="flex items-center justify-between gap-3 flex-wrap">
                                  <span className="text-sm">
                                    {p.subjectName}{p.sectionName ? ` · ${p.sectionName}` : ""} · {formatDate(new Date(p.date))} P{p.periodNumber}
                                  </span>
                                  <Select
                                    value={substitutionsById[r.id]?.[key] ?? ""}
                                    onValueChange={(v) =>
                                      setSubstitutionsById((prev) => ({
                                        ...prev,
                                        [r.id]: { ...(prev[r.id] ?? {}), [key]: v },
                                      }))
                                    }
                                  >
                                    <SelectTrigger className="w-44">
                                      <SelectValue placeholder="Not covered" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {p.candidates.map((c) => (
                                        <SelectItem key={c.facultyId} value={c.facultyId}>{c.facultyName}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {isPrincipalOtherDecision && (
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
                            {OTHER_LEAVE_CATEGORY_ORDER.map((c) => (
                              <SelectItem key={c} value={c}>{OTHER_LEAVE_CATEGORY_LABELS[c]}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[11px] text-muted-foreground">Only visible in your own Staff Leave History - never shown to the requester, their HOD, or anyone else.</p>
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
                        <Check className="h-4 w-4 mr-1" /> {isHodOtherDecision ? "Forward to Principal" : "Approve"}
                      </Button>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
