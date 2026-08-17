"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { AlertTriangle, CalendarPlus } from "lucide-react";
import { countWorkingDays, dateKey, todayISODate } from "@/lib/leave/dayCounter";
import { HALF_DAY_ELIGIBLE_TYPES } from "@/lib/leave/seedData";
import { toDate as toJsDate, formatDate } from "@/lib/utils";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest, LeaveTypeCode } from "@/types/leave";
import type { Holiday } from "@/types";

interface BalanceEntry {
  code: LeaveTypeCode;
  label: string;
  unlimited: boolean;
  remaining?: number;
}

interface LeaveApplyFormProps {
  backHref: string;
}

export function LeaveApplyForm({ backHref }: LeaveApplyFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // "Extend Leave" (see LeaveProfileView.tsx) - the id of one of the
  // requester's own already-approved requests, linked via the search param
  // it's launched from. Same form, same POST endpoint - just prefilled and
  // tagged so the new request carries the connection through.
  const extendId = searchParams.get("extend");
  const todayISO = todayISODate();
  const [types, setTypes] = useState<BalanceEntry[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(true);
  const [extendSource, setExtendSource] = useState<LeaveRequest | null>(null);
  const [leaveTypeCode, setLeaveTypeCode] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [halfDaySession, setHalfDaySession] = useState<"FN" | "AN">("FN");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());

  const isHalfDayEligible = HALF_DAY_ELIGIBLE_TYPES.includes(leaveTypeCode as LeaveTypeCode);

  useEffect(() => {
    fetch("/api/college/holidays")
      .then((r) => r.json() as Promise<{ holidays: Holiday[] }>)
      .then((d) => {
        const keys = (d.holidays ?? []).map((h) => toJsDate(h.date)).filter((d): d is Date => !!d).map(dateKey);
        setHolidayDates(new Set(keys));
      })
      .catch(() => {
        // Non-fatal - the preview just won't exclude holidays; the server
        // (applications/route.ts) is still the authoritative count.
      });
  }, []);

  // Live preview only - the server never blocks on this (see applications/route.ts),
  // it just warns the requester before they submit that some days will exceed
  // their balance and be treated as Loss of Pay (final split happens at approval).
  // Matches the server's countWorkingDays exactly - Sundays and declared
  // holidays within the range don't count, same rule the server enforces.
  const selectedType = types.find((t) => t.code === leaveTypeCode);
  const previewTotalDays =
    fromDate && toDate && toDate >= fromDate ? countWorkingDays(new Date(fromDate), new Date(toDate), holidayDates, isHalfDay) : 0;
  const lopPreviewDays =
    selectedType && !selectedType.unlimited && selectedType.remaining !== undefined && previewTotalDays > selectedType.remaining
      ? previewTotalDays - selectedType.remaining
      : 0;

  function handleLeaveTypeChange(value: string) {
    setLeaveTypeCode(value);
    if (!HALF_DAY_ELIGIBLE_TYPES.includes(value as LeaveTypeCode)) setIsHalfDay(false);
  }

  useEffect(() => {
    fetch("/api/leave/balances")
      .then((r) => r.json() as Promise<{ leaveTypes: BalanceEntry[] }>)
      .then((data) => setTypes(data.leaveTypes ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load leave types" }))
      .finally(() => setIsLoadingTypes(false));
  }, []);

  useEffect(() => {
    if (!extendId) return;
    fetch(`/api/leave/applications/${extendId}`)
      .then((r) => r.json() as Promise<{ request?: LeaveRequest; error?: string }>)
      .then((data) => {
        if (!data.request) { toast({ variant: "destructive", title: "Couldn't load the leave you're extending" }); return; }
        setExtendSource(data.request);
        setLeaveTypeCode(data.request.isOtherRequest && !data.request.leaveTypeCode ? "OTHER" : data.request.leaveTypeCode ?? "OTHER");
        // Continues the day right after the original's last day - never
        // earlier than today, same "no backdating" rule as any other request.
        const originalTo = toJsDate(data.request.toDate);
        if (originalTo) {
          const dayAfter = new Date(originalTo);
          dayAfter.setDate(dayAfter.getDate() + 1);
          const dayAfterISO = dayAfter.toISOString().split("T")[0];
          setFromDate(dayAfterISO > todayISODate() ? dayAfterISO : todayISODate());
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Couldn't load the leave you're extending" }));
  }, [extendId]);

  async function handleSubmit() {
    if (!fromDate || !toDate || !reason.trim() || !leaveTypeCode) {
      toast({ variant: "destructive", title: "All fields are required" });
      return;
    }
    if (fromDate < todayISO || toDate < todayISO) {
      toast({ variant: "destructive", title: "Leave cannot be applied for a date before today" });
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/leave/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveTypeCode: leaveTypeCode === "OTHER" ? undefined : leaveTypeCode,
          isOtherRequest: leaveTypeCode === "OTHER",
          fromDate,
          toDate,
          isHalfDay,
          halfDaySession: isHalfDay ? halfDaySession : undefined,
          reason: reason.trim(),
          extendsRequestId: extendId ?? undefined,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      toast({ variant: "success", title: "Leave request submitted" });
      router.push(backHref);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <PageHeader
        title={extendId ? "Extend Leave" : "Apply for Leave"}
        description={extendId ? "Request more days on an already-approved leave" : "Submit a new leave request"}
      />
      {extendId && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
          <CalendarPlus className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {extendSource ? (
              <>
                Extending your {extendSource.isOtherRequest && !extendSource.leaveTypeCode ? "Other" : LEAVE_TYPE_LABELS[extendSource.leaveTypeCode!] ?? extendSource.leaveTypeCode}{" "}
                leave approved for {formatDate(extendSource.fromDate)} - {formatDate(extendSource.toDate)}. This is a new
                request and will go through approval again.
              </>
            ) : (
              "Loading the leave you're extending…"
            )}
          </span>
        </div>
      )}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div className="space-y-2">
            <Label>Leave Type</Label>
            <Select value={leaveTypeCode} onValueChange={handleLeaveTypeChange} disabled={isLoadingTypes || !!extendId}>
              <SelectTrigger>
                <SelectValue placeholder="Select leave type" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.code} value={t.code}>
                    {t.label}
                    {!t.unlimited ? ` (${t.remaining} remaining)` : ""}
                  </SelectItem>
                ))}
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
            {extendId && <p className="text-xs text-muted-foreground">Kept the same as the leave you're extending.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>From</Label>
              <Input type="date" value={fromDate} min={todayISO} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>To</Label>
              <Input type="date" value={toDate} min={fromDate || todayISO} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>

          <label className={`flex items-center gap-2 text-sm ${isHalfDayEligible ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
            <Checkbox
              checked={isHalfDay}
              onCheckedChange={(c) => setIsHalfDay(c === true)}
              disabled={!isHalfDayEligible}
            />
            Half day
            {!isHalfDayEligible && leaveTypeCode && (
              <span className="text-xs text-muted-foreground">(not available for this leave type)</span>
            )}
          </label>

          {isHalfDay && isHalfDayEligible && (
            <div className="space-y-2">
              <Label>Which half?</Label>
              <Select value={halfDaySession} onValueChange={(v) => setHalfDaySession(v as "FN" | "AN")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FN">Forenoon</SelectItem>
                  <SelectItem value="AN">Afternoon</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {lopPreviewDays > 0 && selectedType && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                You have {selectedType.remaining} {selectedType.label} remaining. This request is for {previewTotalDays} day(s) —{" "}
                {lopPreviewDays} day(s) will exceed your balance and be treated as Loss of Pay (-{lopPreviewDays}x).
              </span>
            </div>
          )}

          <div className="space-y-2">
            <Label>Reason</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Reason for leave" />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => router.push(backHref)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} loading={isSubmitting}>
              Submit Request
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
