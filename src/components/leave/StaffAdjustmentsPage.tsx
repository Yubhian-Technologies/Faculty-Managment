"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { todayISODate } from "@/lib/leave/dayCounter";
import { formatDate } from "@/lib/utils";
import { ROLE_LABELS, type UserRole } from "@/types/core";
import type { StaffAdjustment } from "@/types/leave";

interface Person { uid: string; name: string; role: string; department: string }
interface PeriodOption {
  date: string;
  day: string;
  periodNumber: number;
  timetableSlotId: string;
  sectionName?: string;
  subjectName: string;
  candidates: { facultyId: string; facultyName: string; facultyDepartment?: string }[];
}

const UNASSIGNED = "__none__";

function roleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}

function personLabel(p: Person): string {
  return `${p.name} · ${roleLabel(p.role)}${p.department ? ` · ${p.department}` : ""}`;
}

// The manager-side Adjustments module: a Principal / Vice Principal / HOD /
// College Office member arranges cover for someone below them who has other
// work on a date or range (no leave request involved). See
// lib/leave/staffAdjustmentScope.ts for who can adjust whom.
export function StaffAdjustmentsPage() {
  const todayISO = todayISODate();
  const [subjects, setSubjects] = useState<Person[]>([]);
  const [adjustments, setAdjustments] = useState<StaffAdjustment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [subjectUid, setSubjectUid] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [reason, setReason] = useState("");
  const [periods, setPeriods] = useState<PeriodOption[]>([]);
  const [coverCandidates, setCoverCandidates] = useState<Person[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(false);
  const [substituteByPeriod, setSubstituteByPeriod] = useState<Record<string, string>>({});
  const [coverUid, setCoverUid] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<StaffAdjustment | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // A single day when To is left blank.
  const effectiveTo = toDate || fromDate;
  const rangeValid = !!fromDate && effectiveTo >= fromDate;

  const loadAll = useCallback(async () => {
    try {
      const [optionsRes, listRes] = await Promise.all([
        fetch("/api/leave/staff-adjustments/options").then((r) => r.json() as Promise<{ subjects?: Person[] }>),
        fetch("/api/leave/staff-adjustments").then((r) => r.json() as Promise<{ adjustments?: StaffAdjustment[] }>),
      ]);
      setSubjects(optionsRes.subjects ?? []);
      setAdjustments(listRes.adjustments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load adjustments" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void (async () => { await loadAll(); })();
  }, [loadAll]);

  // Periods + free cover people for the chosen person and dates - re-fetched
  // whenever any of the three change, since "free" depends on all of them.
  useEffect(() => {
    if (!subjectUid || !rangeValid) {
      void (async () => {
        setPeriods([]);
        setCoverCandidates([]);
        setSubstituteByPeriod({});
        setCoverUid("");
      })();
      return;
    }
    let cancelled = false;
    void (async () => { setIsLoadingOptions(true); })();
    fetch(`/api/leave/staff-adjustments/options?subjectUid=${encodeURIComponent(subjectUid)}&fromDate=${fromDate}&toDate=${effectiveTo}`)
      .then((r) => r.json() as Promise<{ periods?: PeriodOption[]; coverCandidates?: Person[]; error?: string }>)
      .then((d) => {
        if (cancelled) return;
        if (d.error) { toast({ variant: "destructive", title: d.error }); return; }
        setPeriods(d.periods ?? []);
        setCoverCandidates(d.coverCandidates ?? []);
        setSubstituteByPeriod({});
        setCoverUid("");
      })
      .catch(() => { if (!cancelled) toast({ variant: "destructive", title: "Failed to load who is available" }); })
      .finally(() => { if (!cancelled) setIsLoadingOptions(false); });
    return () => { cancelled = true; };
  }, [subjectUid, fromDate, effectiveTo, rangeValid]);

  async function handleSubmit() {
    if (!subjectUid || !rangeValid || !reason.trim()) {
      toast({ variant: "destructive", title: "Pick a person, the date(s) and a reason" });
      return;
    }
    const picks = periods
      .map((p) => ({ date: p.date, timetableSlotId: p.timetableSlotId, substituteFacultyId: substituteByPeriod[`${p.date}|${p.timetableSlotId}`] }))
      .filter((p) => p.substituteFacultyId);
    if (picks.length === 0 && !coverUid) {
      toast({ variant: "destructive", title: "Name who covers a period, or who covers their other duties" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/leave/staff-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectUid, fromDate, toDate: effectiveTo, reason: reason.trim(),
          periodSubstitutions: picks.length > 0 ? picks : undefined,
          coverUid: coverUid || undefined,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save adjustment");
      toast({ variant: "success", title: "Adjustment arranged" });
      setSubjectUid(""); setFromDate(""); setToDate(""); setReason("");
      await loadAll();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save adjustment" });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/leave/staff-adjustments/${cancelTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL" }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to cancel");
      toast({ variant: "success", title: "Adjustment cancelled" });
      setCancelTarget(null);
      await loadAll();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to cancel" });
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Adjustments"
        description="Arrange cover for someone below you who has other work on a date or range - no leave request needed."
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">New Adjustment</CardTitle>
          <CardDescription>
            Pick the person who has other work, the date (or From / To range), then who takes over their classes and duties.
            Anyone already teaching then, on leave, or tied up in another adjustment isn&apos;t offered.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="h-24 bg-muted animate-pulse rounded-lg" />
          ) : subjects.length === 0 ? (
            <p className="text-sm text-muted-foreground">There is no one below you to arrange an adjustment for yet.</p>
          ) : (
            <>
              <div className="space-y-2">
                <Label>Who has other work?</Label>
                <Select value={subjectUid} onValueChange={setSubjectUid}>
                  <SelectTrigger><SelectValue placeholder="Select a person" /></SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => <SelectItem key={s.uid} value={s.uid}>{personLabel(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>From</Label>
                  <Input type="date" value={fromDate} min={todayISO} onChange={(e) => setFromDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>To <span className="font-normal text-muted-foreground">(blank = one day)</span></Label>
                  <Input type="date" value={toDate} min={fromDate || todayISO} onChange={(e) => setToDate(e.target.value)} />
                </div>
              </div>

              {isLoadingOptions && <div className="h-20 bg-muted animate-pulse rounded-lg" />}

              {!isLoadingOptions && subjectUid && rangeValid && (
                <>
                  {periods.length > 0 && (
                    <div className="space-y-2">
                      <Label>Who takes their classes?</Label>
                      <p className="text-xs text-muted-foreground">
                        Leave a period unassigned if you&apos;re sorting it out another way.
                      </p>
                      <div className="space-y-2 rounded-lg border p-3">
                        {periods.map((p) => {
                          const key = `${p.date}|${p.timetableSlotId}`;
                          return (
                            <div key={key} className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="text-sm min-w-0">
                                <span className="font-medium">{p.subjectName}</span>
                                {p.sectionName && <span className="text-muted-foreground"> · {p.sectionName}</span>}
                                <span className="text-muted-foreground"> · {formatDate(new Date(p.date))} P{p.periodNumber}</span>
                              </div>
                              <Select
                                value={substituteByPeriod[key] ?? UNASSIGNED}
                                onValueChange={(v) => setSubstituteByPeriod((prev) => ({ ...prev, [key]: v === UNASSIGNED ? "" : v }))}
                              >
                                <SelectTrigger className="w-52">
                                  <SelectValue placeholder={p.candidates.length === 0 ? "None available" : "Unassigned"} />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                                  {p.candidates.map((c) => (
                                    <SelectItem key={c.facultyId} value={c.facultyId}>
                                      {c.facultyName}
                                      {c.facultyDepartment && <span className="text-muted-foreground"> · {c.facultyDepartment}</span>}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>Who covers their other duties? <span className="font-normal text-muted-foreground">(optional if periods are assigned)</span></Label>
                    <Select value={coverUid || UNASSIGNED} onValueChange={(v) => setCoverUid(v === UNASSIGNED ? "" : v)}>
                      <SelectTrigger>
                        <SelectValue placeholder={coverCandidates.length === 0 ? "No one available" : "No one"} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNASSIGNED}>No one</SelectItem>
                        {coverCandidates.map((c) => <SelectItem key={c.uid} value={c.uid}>{personLabel(c)}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              <div className="space-y-2">
                <Label>Reason / other work</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="e.g. Invigilation duty, university meeting" />
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSubmit} loading={isSubmitting} disabled={!subjectUid || !rangeValid}>
                  Arrange Adjustment
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Arranged Adjustments</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="h-16 bg-muted animate-pulse rounded-lg" />
          ) : adjustments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">Nothing arranged yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {adjustments.map((a) => (
                <li key={a.id} className="p-3 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium">{a.subjectName}</p>
                    <span className="text-xs text-muted-foreground">
                      {a.fromDate === a.toDate ? formatDate(new Date(a.fromDate)) : `${formatDate(new Date(a.fromDate))} - ${formatDate(new Date(a.toDate))}`}
                    </span>
                    <Badge variant={a.status === "ACTIVE" ? "secondary" : "outline"} className="text-[10px]">
                      {a.status === "ACTIVE" ? "Active" : "Cancelled"}
                    </Badge>
                    {a.status === "ACTIVE" && (
                      <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => setCancelTarget(a)}>
                        Cancel
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{a.reason}</p>
                  {a.coverName && <p className="text-xs">Duties covered by <span className="font-medium">{a.coverName}</span></p>}
                  {(a.periodSubstitutions ?? []).length > 0 && (
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      {(a.periodSubstitutions ?? []).map((p) => (
                        <li key={`${p.date}|${p.timetableSlotId}`}>
                          {formatDate(new Date(p.date))} P{p.periodNumber} · {p.subjectName}
                          {p.sectionName ? ` (${p.sectionName})` : ""} → <span className="text-foreground">{p.substituteFacultyName}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[11px] text-muted-foreground">Arranged by {a.createdByName}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(o) => { if (!o) setCancelTarget(null); }}
        title="Cancel this adjustment?"
        description={cancelTarget ? `The cover arranged for ${cancelTarget.subjectName} will be withdrawn and everyone involved is notified.` : undefined}
        confirmLabel="Cancel Adjustment"
        variant="destructive"
        onConfirm={confirmCancel}
        loading={isCancelling}
      />
    </div>
  );
}
