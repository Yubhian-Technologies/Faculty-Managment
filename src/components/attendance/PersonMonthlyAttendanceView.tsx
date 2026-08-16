"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarDays, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { isManualEditWindowOpen, MANUAL_EDIT_WINDOW_CLOSED_MESSAGE } from "@/lib/attendance/attendanceWindow";
import { ATTENDANCE_STATUS_LABELS } from "@/types";
import type { AttendanceRecord, AttendanceStatus } from "@/types";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const YEARS = [2024, 2025, 2026];

function statusBadgeClass(status: AttendanceStatus): string {
  switch (status) {
    case "PRESENT":  return "bg-green-100 text-green-800 border-green-200";
    case "ABSENT":   return "bg-red-100 text-red-800 border-red-200";
    case "HALF_DAY": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "ON_LEAVE": return "bg-blue-100 text-blue-800 border-blue-200";
    case "ON_DUTY":  return "bg-purple-100 text-purple-800 border-purple-200";
    case "HOLIDAY":  return "bg-gray-100 text-gray-700 border-gray-200";
    case "WEEKEND":  return "bg-gray-100 text-gray-700 border-gray-200";
    default:         return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function resolveDate(raw: unknown): Date | null {
  const withToDate = raw as { toDate?: () => Date; seconds?: number; _seconds?: number } | null;
  if (!withToDate) return null;
  if (typeof withToDate.toDate === "function") return withToDate.toDate();
  const secs = withToDate._seconds ?? withToDate.seconds;
  return secs != null ? new Date(secs * 1000) : null;
}

interface PersonMonthlyAttendanceViewProps {
  // The login uid (users/{uid} doc id) of the person whose month this is -
  // NOT a FacultyMember/other profile doc id, which can differ. Callers
  // must resolve to this uid before linking here (e.g. a roster row's own
  // `uid`, already the login uid - see AttendanceReportView).
  facultyId: string;
  backHref: string;
}

// Monthly per-person attendance view with inline edit, for HOD reviewing a
// Faculty member's month or Principal/VP reviewing an HOD's month - the
// same one-tier cascade /api/college/attendance/manual already enforces
// server-side. Mirrors the self-view "Daily Records" list every role's own
// "My Attendance" page already has, plus a "Mark" action per day so a
// missed/incorrect day doesn't require hunting through the single-date
// Attendance Report one day at a time.
export function PersonMonthlyAttendanceView({ facultyId, backHref }: PersonMonthlyAttendanceViewProps) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [personName, setPersonName] = useState<string | null>(null);
  const [records, setRecords] = useState<(AttendanceRecord & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [markDate, setMarkDate] = useState<string | null>(null);
  const [manualCheckIn, setManualCheckIn] = useState("");
  const [manualCheckOut, setManualCheckOut] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [isMarking, setIsMarking] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/attendance?year=${year}&month=${month}&facultyId=${facultyId}`);
      const json = await res.json() as { personName?: string | null; records?: (AttendanceRecord & { id: string })[]; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load attendance" });
        return;
      }
      setPersonName(json.personName ?? null);
      setRecords(json.records ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load attendance" });
    } finally {
      setIsLoading(false);
    }
  }, [year, month, facultyId]);

  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  function openMarkDialog(date: string, existing?: AttendanceRecord & { id: string }) {
    setMarkDate(date);
    setManualCheckIn(existing?.checkIn ?? "");
    setManualCheckOut(existing?.checkOut ?? "");
    setManualReason("");
  }

  async function handleManualMark() {
    if (!markDate) return;
    setIsMarking(true);
    try {
      const res = await fetch("/api/college/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId,
          date: markDate,
          checkIn: manualCheckIn || undefined,
          checkOut: manualCheckOut || undefined,
          reason: manualReason,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to mark attendance" });
        return;
      }
      toast({ title: "Attendance updated" });
      setMarkDate(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to mark attendance" });
    } finally {
      setIsMarking(false);
    }
  }

  const recordByDate = new Map(records.map((r) => [dateKey(resolveDate(r.date) ?? new Date(0)), r]));

  // The month's real calendar days, not just days with a record, so "no
  // record yet" days are still reachable to mark - same rationale as the
  // roster report's NOT_MARKED synthesis.
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = dateKey(now);
  const days = Array.from({ length: daysInMonth }, (_, i) => {
    const d = new Date(year, month - 1, i + 1);
    const key = dateKey(d);
    return { date: d, key, record: recordByDate.get(key) };
  }).filter((d) => d.key <= todayKey || d.record); // hide pure future days with nothing to show

  const checkOutNotAfterCheckIn = !!manualCheckIn && !!manualCheckOut && manualCheckOut <= manualCheckIn;
  // Editing is only open for the current month, up to the 25th (see
  // isManualEditWindowOpen) - viewing a past/locked month stays fully
  // readable, just without the "Mark" action on any of its days.
  const canEditThisMonth = isManualEditWindowOpen(new Date(year, month - 1, 1));

  return (
    <div className="space-y-6">
      <PageHeader
        title={personName ? `${personName}'s Attendance` : "Attendance"}
        description="Review and correct any day this month"
        actions={
          <Button variant="outline" asChild>
            <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Month" />
          </SelectTrigger>
          <SelectContent>
            {MONTH_NAMES.map((name, idx) => (
              <SelectItem key={idx + 1} value={String(idx + 1)}>{name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="w-28">
            <SelectValue placeholder="Year" />
          </SelectTrigger>
          <SelectContent>
            {YEARS.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!canEditThisMonth && (
        <p className="text-xs text-muted-foreground">{MANUAL_EDIT_WINDOW_CLOSED_MESSAGE}</p>
      )}

      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
              Daily Records — {MONTH_NAMES[month - 1]} {year}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {days.map(({ date, key, record }) => {
                const dayName = date.toLocaleDateString("en-IN", { weekday: "short" });
                return (
                  <div key={key} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="w-32 shrink-0">
                      <p className="text-sm font-medium">{formatDate(date)}</p>
                      <p className="text-xs text-muted-foreground">{dayName}</p>
                    </div>

                    <div className="flex-1 flex items-center gap-1.5">
                      {record ? (
                        <>
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(record.status)}`}>
                            {ATTENDANCE_STATUS_LABELS[record.status]}
                          </span>
                          {record.status === "PRESENT" && isLateCheckIn(record.checkIn) && (
                            <span className="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                              Late
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground">No record</span>
                      )}
                    </div>

                    <div className="text-right shrink-0">
                      {record?.checkIn || record?.checkOut ? (
                        <p className="text-xs text-muted-foreground">
                          {record.checkIn ?? "—"} – {record.checkOut ?? "—"}
                        </p>
                      ) : null}
                      {record?.remarks ? (
                        <p className="text-xs text-muted-foreground italic mt-0.5">{record.remarks}</p>
                      ) : null}
                    </div>

                    {canEditThisMonth && (
                      <Button variant="outline" size="sm" className="shrink-0" onClick={() => openMarkDialog(key, record)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Mark
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={!!markDate}
        onOpenChange={(open) => { if (!open) setMarkDate(null); }}
        title={`Mark attendance for ${markDate ?? "this day"}?`}
        description="Use this when they can't complete self check-in/out themselves (e.g. they left campus for official work). This is recorded as a manual entry, distinct from a real face+location check-in."
        confirmLabel="Save"
        loading={isMarking}
        confirmDisabled={!manualReason.trim() || (!manualCheckIn && !manualCheckOut) || checkOutNotAfterCheckIn}
        onConfirm={() => void handleManualMark()}
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="person-manual-checkin">Check In</Label>
              <Input id="person-manual-checkin" type="time" value={manualCheckIn} onChange={(e) => setManualCheckIn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="person-manual-checkout">Check Out</Label>
              <Input id="person-manual-checkout" type="time" value={manualCheckOut} onChange={(e) => setManualCheckOut(e.target.value)} />
            </div>
          </div>
          {checkOutNotAfterCheckIn && (
            <p className="text-xs text-destructive">Check-out must be after check-in.</p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="person-manual-reason">Reason (required)</Label>
            <Textarea
              id="person-manual-reason"
              value={manualReason}
              onChange={(e) => setManualReason(e.target.value)}
              rows={3}
              placeholder="Why are you marking this manually?"
            />
          </div>
        </div>
      </ConfirmDialog>
    </div>
  );
}
