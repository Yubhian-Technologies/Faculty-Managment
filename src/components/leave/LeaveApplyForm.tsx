"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { AlertTriangle, CalendarPlus, Users } from "lucide-react";
import { countWorkingDays, dateKey, isoDateKey, todayISODate } from "@/lib/leave/dayCounter";
import { HALF_DAY_ELIGIBLE_TYPES } from "@/lib/leave/seedData";
import { toDate as toJsDate, formatDate } from "@/lib/utils";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest, LeaveTypeCode } from "@/types/leave";
import type { Holiday, SummerHoliday } from "@/types";

interface BalanceEntry {
  code: LeaveTypeCode;
  label: string;
  unlimited: boolean;
  remaining?: number;
}

interface PeriodCoverageEntry {
  date: string;
  day: string;
  periodNumber: number;
  timetableSlotId: string;
  sectionName?: string;
  subjectName: string;
  candidates: { facultyId: string; facultyName: string }[];
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
  const [periods, setPeriods] = useState<PeriodCoverageEntry[]>([]);
  const [isLoadingPeriods, setIsLoadingPeriods] = useState(false);
  const [substituteByPeriod, setSubstituteByPeriod] = useState<Record<string, string>>({});
  // College Office's declared Summer Holidays range (see the Holidays page's
  // "Summer Holidays" section) - whichever one hasn't fully ended yet, soonest
  // first. Selecting "Summer Holidays" below locks From/To to this exact
  // range (see the effect further down) rather than letting the requester
  // pick their own dates - it's the college's declared break, not a personal
  // date choice. Kept out of the type dropdown entirely (see `types` filter
  // below) when nothing's been set yet.
  const [summerHoliday, setSummerHoliday] = useState<{ fromISO: string; toISO: string; from: Date; to: Date } | null>(null);

  const isHalfDayEligible = HALF_DAY_ELIGIBLE_TYPES.includes(leaveTypeCode as LeaveTypeCode);
  // Forenoon's window has already passed for a half-day request filed for
  // today, once it's 11am or later - only a future date still has a whole
  // forenoon ahead of it, so this never restricts those.
  const isForenoonBlocked = isHalfDay && fromDate === todayISO && new Date().getHours() >= 11;
  // Derived, not stored - if the requester picked Forenoon earlier and it
  // only just became blocked (they left the tab open past 11am), this
  // silently falls back to Afternoon everywhere it's read (the Select's
  // value below and the submitted payload) without needing an effect to
  // "correct" halfDaySession after the fact.
  const effectiveHalfDaySession = isForenoonBlocked ? "AN" : halfDaySession;

  function handleDurationModeChange(mode: "FULL" | "HALF") {
    const half = mode === "HALF";
    setIsHalfDay(half);
    // Half day is a single day - From and To lock to the same date the
    // moment the mode switches (see handleFromDateChange for the reverse:
    // keeping them locked as From changes afterwards).
    if (half && fromDate) setToDate(fromDate);
  }

  function handleFromDateChange(value: string) {
    setFromDate(value);
    if (isHalfDay) setToDate(value);
  }

  useEffect(() => {
    fetch("/api/college/holidays")
      .then((r) => r.json() as Promise<{ holidays: Holiday[] }>)
      .then((d) => {
        // Students-only holidays don't exempt faculty - matches the server's
        // own filtering in getHolidayDateKeys (holidaysCount.ts). Absent
        // appliesTo (legacy holidays) still counts, same as the server.
        const keys = (d.holidays ?? [])
          .filter((h) => h.appliesTo !== "STUDENTS")
          .map((h) => toJsDate(h.date)).filter((d): d is Date => !!d).map(dateKey);
        setHolidayDates(new Set(keys));
      })
      .catch(() => {
        // Non-fatal - the preview just won't exclude holidays; the server
        // (applications/route.ts) is still the authoritative count.
      });
  }, []);

  useEffect(() => {
    fetch("/api/college/summer-holidays")
      .then((r) => r.json() as Promise<{ summerHolidays?: SummerHoliday[] }>)
      .then((d) => {
        const today = todayISO;
        // Whichever range hasn't fully ended yet, soonest first - lets a
        // requester pick "Summer Holidays" well before it starts, not just
        // once it's imminent (unlike the dashboard banner, which only shows
        // in the day-before window - see SummerHolidayBanner.tsx).
        const upcoming = (d.summerHolidays ?? [])
          .map((s) => {
            const from = toJsDate(s.fromDate);
            const to = toJsDate(s.toDate);
            if (!from || !to) return null;
            return { fromISO: isoDateKey(from), toISO: isoDateKey(to), from, to };
          })
          .filter((s): s is { fromISO: string; toISO: string; from: Date; to: Date } => !!s && s.toISO >= today)
          .sort((a, b) => a.fromISO.localeCompare(b.fromISO));
        setSummerHoliday(upcoming[0] ?? null);
      })
      .catch(() => {
        // Non-fatal - "Summer Holidays" just won't be offered as an option.
      });
  }, [todayISO]);

  // Defaults From/To to the FULL declared range the moment "Summer Holidays"
  // is picked fresh (not via Extend, which computes its own From/To below) -
  // just a starting point, not a lock. The requester can then narrow it to
  // whatever sub-range they actually want (see the From/To inputs' min/max
  // below, clamped to the declared range either way) - e.g. office declares
  // the 20th through next month's 20th, but someone only takes 10 or 11 days
  // of it. Only fires once on selection (fromDate/toDate aren't in the
  // dependency array), so it never overwrites a range the requester has
  // already narrowed down.
  useEffect(() => {
    // Wrapped so the setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect).
    void (async () => {
      if (leaveTypeCode === "SH" && summerHoliday && !extendId) {
        setFromDate(summerHoliday.fromISO);
        setToDate(summerHoliday.toISO);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaveTypeCode, extendId]);

  // Extending a Summer Holidays request (see LeaveProfileView.tsx's Extend
  // button, now offered for SH the same way it already was for Sick Leave) -
  // From already restarts the day after the original's last day (see the
  // extend-fetch effect below); this defaults To to the rest of the declared
  // range, so "extend" reads as "take more of what's left", not a blank
  // range to fill in from scratch. Still just a default - narrowable the
  // same as a fresh SH selection. Only defaults once (guarded by `!toDate`),
  // so it never overwrites a range the requester has since narrowed down.
  useEffect(() => {
    void (async () => {
      if (extendId && leaveTypeCode === "SH" && summerHoliday && !toDate) {
        setToDate(summerHoliday.toISO);
      }
    })();
  }, [extendId, leaveTypeCode, summerHoliday, toDate]);

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

  // Standard leave types only (never "Other" or "Summer Holidays" - see
  // PeriodSubstitution in types/leave.ts) - fetches which of the requester's
  // own teaching periods fall within this date range and who in their
  // department is free to cover each one. Empty for a non-teaching requester
  // or a range with no affected periods; the picker below simply doesn't
  // render in that case. Summer Holidays is skipped outright - it's the
  // college's own declared break, there's nothing to arrange substitute
  // coverage for.
  useEffect(() => {
    if (!leaveTypeCode || leaveTypeCode === "OTHER" || leaveTypeCode === "SH" || !fromDate || !toDate || toDate < fromDate) {
      setPeriods([]);
      setSubstituteByPeriod({});
      return;
    }
    let cancelled = false;
    setIsLoadingPeriods(true);
    fetch(`/api/leave/period-coverage?fromDate=${fromDate}&toDate=${toDate}`)
      .then((r) => r.json() as Promise<{ periods?: PeriodCoverageEntry[]; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        setPeriods(data.periods ?? []);
        setSubstituteByPeriod({});
      })
      .catch(() => {
        if (!cancelled) setPeriods([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPeriods(false);
      });
    return () => { cancelled = true; };
  }, [leaveTypeCode, fromDate, toDate]);

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
    // Summer Holidays defaults to College Office's own declared range but can
    // be narrowed down (see the min/max on the inputs above), so an already-
    // ongoing range (fromDate before today, toDate still ahead) is expected
    // and not backdating in the sense this check exists to catch elsewhere.
    if (leaveTypeCode === "SH") {
      // Covers the Extend case running out of range too - a day-after-the-
      // original fromDate that's pushed past the declared range's end (every
      // day of it already taken) ends up later than toDate here rather than
      // within it.
      if (!summerHoliday || fromDate > toDate || fromDate < summerHoliday.fromISO || toDate > summerHoliday.toISO) {
        toast({
          variant: "destructive",
          title: summerHoliday && fromDate > summerHoliday.toISO
            ? "No days remain in the declared Summer Holidays range"
            : "Summer Holidays dates must fall within your College Office's declared range",
        });
        return;
      }
    } else if (fromDate < todayISO || toDate < todayISO) {
      toast({ variant: "destructive", title: "Leave cannot be applied for a date before today" });
      return;
    }
    if (periods.length > 0 && periods.some((p) => !substituteByPeriod[`${p.date}|${p.timetableSlotId}`])) {
      toast({ variant: "destructive", title: "Select a substitute for every affected period before submitting" });
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
          halfDaySession: isHalfDay ? effectiveHalfDaySession : undefined,
          reason: reason.trim(),
          extendsRequestId: extendId ?? undefined,
          periodSubstitutions: periods.length > 0
            ? periods.map((p) => ({
                date: p.date,
                timetableSlotId: p.timetableSlotId,
                substituteFacultyId: substituteByPeriod[`${p.date}|${p.timetableSlotId}`],
              }))
            : undefined,
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
                {types
                  // Only offered once College Office has actually declared a
                  // still-relevant range - otherwise there's nothing to lock
                  // the dates to (see the summerHoliday fetch above).
                  .filter((t) => t.code !== "SH" || summerHoliday)
                  .map((t) => (
                    <SelectItem key={t.code} value={t.code}>
                      {t.code === "SH" && summerHoliday
                        ? `${t.label} (${formatDate(summerHoliday.from)} - ${formatDate(summerHoliday.to)})`
                        : t.label}
                      {!t.unlimited ? ` (${t.remaining} remaining)` : ""}
                    </SelectItem>
                  ))}
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
            {extendId && <p className="text-xs text-muted-foreground">Kept the same as the leave you&rsquo;re extending.</p>}
          </div>

          <div className="space-y-2">
            <Label>Duration</Label>
            <div className="flex items-center gap-2">
              <SegmentedTabs
                value={isHalfDay ? "HALF" : "FULL"}
                onChange={(v) => isHalfDayEligible && handleDurationModeChange(v as "FULL" | "HALF")}
                options={[
                  { key: "FULL", label: "Full day" },
                  { key: "HALF", label: "Half day" },
                ]}
                className={!isHalfDayEligible ? "cursor-not-allowed opacity-50" : undefined}
              />
              {!isHalfDayEligible && leaveTypeCode && (
                <span className="text-xs text-muted-foreground">Half day not available for this leave type</span>
              )}
            </div>
          </div>

          <div className={isHalfDay ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
            <div className="space-y-2">
              <Label>From</Label>
              <Input
                type="date"
                value={fromDate}
                min={leaveTypeCode === "SH" && summerHoliday ? summerHoliday.fromISO : todayISO}
                max={leaveTypeCode === "SH" && summerHoliday ? summerHoliday.toISO : undefined}
                onChange={(e) => handleFromDateChange(e.target.value)}
              />
            </div>
            {/* Half day is always that same single day - To stays locked equal
                to From under the hood (see handleFromDateChange/
                handleDurationModeChange) and is still sent as such on submit,
                just not shown here since there's nothing to actually pick. */}
            {!isHalfDay && (
              <div className="space-y-2">
                <Label>To</Label>
                <Input
                  type="date"
                  value={toDate}
                  min={fromDate || todayISO}
                  max={leaveTypeCode === "SH" && summerHoliday ? summerHoliday.toISO : undefined}
                  onChange={(e) => setToDate(e.target.value)}
                />
              </div>
            )}
          </div>
          {leaveTypeCode === "SH" && summerHoliday && (
            <p className="text-xs text-muted-foreground -mt-2">
              Pick any dates within your College Office&rsquo;s declared range ({formatDate(summerHoliday.from)} - {formatDate(summerHoliday.to)}).
            </p>
          )}

          {isHalfDay && isHalfDayEligible && (
            <div className="space-y-2">
              <Label>Which half?</Label>
              <Select value={effectiveHalfDaySession} onValueChange={(v) => setHalfDaySession(v as "FN" | "AN")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!isForenoonBlocked && <SelectItem value="FN">Forenoon</SelectItem>}
                  <SelectItem value="AN">Afternoon</SelectItem>
                </SelectContent>
              </Select>
              {isForenoonBlocked && (
                <p className="text-xs text-muted-foreground">
                  Forenoon is no longer available for today after 11am - only Afternoon can be selected.
                </p>
              )}
            </div>
          )}

          {isLoadingPeriods && (
            <div className="h-20 bg-muted animate-pulse rounded-lg" />
          )}

          {!isLoadingPeriods && periods.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Users className="h-4 w-4 text-muted-foreground" />
                <Label>Who&rsquo;s covering your classes?</Label>
              </div>
              <p className="text-xs text-muted-foreground">
                Pick a substitute from your department for each period you&rsquo;d otherwise teach on this leave.
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
                        value={substituteByPeriod[key] ?? ""}
                        onValueChange={(v) => setSubstituteByPeriod((prev) => ({ ...prev, [key]: v }))}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder={p.candidates.length === 0 ? "None available" : "Select faculty"} />
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
