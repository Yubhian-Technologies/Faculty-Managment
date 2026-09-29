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
import { OD_PROOF_GRACE_DAYS } from "@/lib/leave/odProof";
import { AlertTriangle, CalendarPlus, Users } from "lucide-react";
import { countWorkingDays, dateKey, isoDateKey, todayISODate } from "@/lib/leave/dayCounter";
import { toDate as toJsDate, formatDate, formatTime12h } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { PeriodCoverageGrid, type PeriodCoverageEntry } from "@/components/leave/PeriodCoverageGrid";
import { HANDOVER_ENABLED } from "@/lib/leave/featureFlags";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { LeaveRequest, LeaveTypeCode } from "@/types/leave";
import type { Holiday, SummerHoliday, WorkingDayOverride } from "@/types";

interface BalanceEntry {
  code: LeaveTypeCode;
  label: string;
  unlimited: boolean;
  remaining?: number;
  // Rendering hints from this college's Settings > Leave Policy - see
  // /api/leave/balances. maxConsecutiveDays/minAdvanceNoticeDays are shown as
  // a hint only; the server (applications/route.ts POST) is the authoritative
  // check either way.
  halfDayAllowed?: boolean;
  reasonOptions?: { label: string; proofRoutedTo?: "HOD" | "EXAM_CELL" }[];
  allowCustomReason?: boolean;
  maxConsecutiveDays?: number;
  minAdvanceNoticeDays?: number;
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
  // Edit an existing PENDING request in place (see LeaveProfileView.tsx's
  // Edit link, shown only while isLeaveRequestEditable) - the id of one of
  // the requester's own not-yet-decided requests. Same form, but submits via
  // PATCH .../{editId} action "EDIT" instead of POST, and pre-fills every
  // editable field (extend deliberately only pre-fills a few, since it's
  // creating a brand new linked request rather than modifying this one).
  const editId = searchParams.get("edit");
  const todayISO = todayISODate();
  const [types, setTypes] = useState<BalanceEntry[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(true);
  const [extendSource, setExtendSource] = useState<LeaveRequest | null>(null);
  const [leaveTypeCode, setLeaveTypeCode] = useState<string>("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isHalfDay, setIsHalfDay] = useState(false);
  // Only meaningful when isHalfDay is false: "ONE" shows a single Date input
  // (To locked equal to From, same trick half-day already uses below) so a
  // single-day request doesn't make someone fill in the same date twice;
  // "RANGE" shows the separate From/To pair. Forced to "RANGE" for Summer
  // Vacation and Extend below since those are inherently a span of days.
  const [fullDayMode, setFullDayMode] = useState<"ONE" | "RANGE">("ONE");
  const [halfDaySession, setHalfDaySession] = useState<"FN" | "AN">("FN");
  const [reason, setReason] = useState("");
  // Only meaningful when the selected type has reasonOptions configured (see
  // BalanceEntry) - true once "Other" is picked from that dropdown, revealing
  // the free-text box below it. Irrelevant (and never shown) for a type with
  // no reasonOptions, which just gets the plain Textarea it always had.
  const [customReasonMode, setCustomReasonMode] = useState(false);
  // Available on every leave type (was OD-only) - an optional "where are you
  // and how do we reach you" pair, see types/leave.ts's
  // placeOfVisit/pointOfContact. Still required for OD specifically (see the
  // validation below and applications/route.ts).
  const [placeOfVisit, setPlaceOfVisit] = useState("");
  const [pointOfContact, setPointOfContact] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [holidayDates, setHolidayDates] = useState<Set<string>>(new Set());
  const [workingDayWeights, setWorkingDayWeights] = useState<Map<string, number>>(new Map());
  const ownRole = useAuthStore((s) => s.user?.role);
  const [periods, setPeriods] = useState<PeriodCoverageEntry[]>([]);
  const [isLoadingPeriods, setIsLoadingPeriods] = useState(false);
  const [substituteByPeriod, setSubstituteByPeriod] = useState<Record<string, string>>({});
  // "" = every department (today's default, own department already sorts
  // first within that). Narrows every period's own candidate list at once -
  // the API already returns candidates from every department (busy/on-leave
  // people already excluded server-side), this just scopes what's shown.
  const [substituteDeptFilter, setSubstituteDeptFilter] = useState("");
  // Optional handover/point-of-contact - any requester, teaching or not, can
  // name a same-department colleague to handle other responsibilities while
  // they're out. Separate from and in addition to period substitutes above -
  // see types/leave.ts's handoverToUid.
  const [handoverCandidates, setHandoverCandidates] = useState<{ uid: string; name: string }[]>([]);
  const [handoverToUid, setHandoverToUid] = useState("");
  // College Office's declared Summer Vacation range (see the Holidays page's
  // "Summer Vacation" section) - whichever one hasn't fully ended yet, soonest
  // first. Selecting "Summer Vacation" below locks From/To to this exact
  // range (see the effect further down) rather than letting the requester
  // pick their own dates - it's the college's declared break, not a personal
  // date choice. Kept out of the type dropdown entirely (see `types` filter
  // below) when nothing's been set yet.
  const [summerHoliday, setSummerHoliday] = useState<{ fromISO: string; toISO: string; from: Date; to: Date } | null>(null);

  const isHalfDayEligible = !!types.find((t) => t.code === leaveTypeCode)?.halfDayAllowed;
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
    // keeping them locked as From changes afterwards). Switching back to
    // Full day falls back to "One day" (same locking) rather than reopening
    // whatever To was left at from a prior Half day toggle.
    if (half && fromDate) setToDate(fromDate);
    else if (!half) setFullDayMode("ONE");
  }

  function handleFullDayModeChange(mode: "ONE" | "RANGE") {
    setFullDayMode(mode);
    // Same lock as half-day: going to a single day snaps To back to From.
    if (mode === "ONE" && fromDate) setToDate(fromDate);
  }

  function handleFromDateChange(value: string) {
    setFromDate(value);
    if (isHalfDay || fullDayMode === "ONE") setToDate(value);
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
        // requester pick "Summer Vacation" well before it starts, not just
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
        // Non-fatal - "Summer Vacation" just won't be offered as an option.
      });
  }, [todayISO]);

  // Defaults From/To to the FULL declared range the moment "Summer Vacation"
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

  // Extending a Summer Vacation request (see LeaveProfileView.tsx's Extend
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

  // Working Day overrides (see college-office/holidays/page.tsx) that name
  // this requester's own role - the inverse of holidayDates above: a Sunday
  // they're specifically required to work on still counts toward the
  // preview, same as the server (applications/route.ts) does via
  // getWorkingDayWeightsForRole - at full weight, or half if that override
  // is itself a half day.
  useEffect(() => {
    if (!ownRole) return;
    fetch("/api/college/working-days")
      .then((r) => r.json() as Promise<{ workingDays: WorkingDayOverride[] }>)
      .then((d) => {
        const weights = new Map<string, number>();
        for (const w of d.workingDays ?? []) {
          if (!w.roles.includes(ownRole)) continue;
          const date = toJsDate(w.date);
          if (date) weights.set(dateKey(date), w.isHalfDay ? 0.5 : 1);
        }
        setWorkingDayWeights(weights);
      })
      .catch(() => {
        // Non-fatal - same fallback as holidayDates above.
      });
  }, [ownRole]);

  // Live preview only - the server never blocks on this (see applications/route.ts),
  // it just warns the requester before they submit that some days will exceed
  // their balance and be treated as Loss of Pay (final split happens at approval).
  // Matches the server's countWorkingDays exactly - Sundays and declared
  // holidays within the range don't count, same rule the server enforces.
  const selectedType = types.find((t) => t.code === leaveTypeCode);
  const previewTotalDays =
    fromDate && toDate && toDate >= fromDate
      ? countWorkingDays(new Date(fromDate), new Date(toDate), holidayDates, isHalfDay, workingDayWeights)
      : 0;
  const lopPreviewDays =
    selectedType && !selectedType.unlimited && selectedType.remaining !== undefined && previewTotalDays > selectedType.remaining
      ? previewTotalDays - selectedType.remaining
      : 0;

  function handleLeaveTypeChange(value: string) {
    setLeaveTypeCode(value);
    if (!types.find((t) => t.code === value)?.halfDayAllowed) setIsHalfDay(false);
    setReason("");
    setCustomReasonMode(false);
    if (value !== "OD") { setPlaceOfVisit(""); setPointOfContact(""); }
    // Summer Vacation defaults From/To to the College Office's full declared
    // range (see the effect below) - inherently a span, so the single-day
    // toggle would just fight that default.
    if (value === "SH") setFullDayMode("RANGE");
  }

  // Standard leave types only (never "Other" or "Summer Vacation" - see
  // PeriodSubstitution in types/leave.ts) - fetches which of the requester's
  // own teaching periods fall within this date range and who in their
  // department is free to cover each one. Empty for a non-teaching requester
  // or a range with no affected periods; the picker below simply doesn't
  // render in that case. Summer Vacation is skipped outright - it's the
  // college's own declared break, there's nothing to arrange substitute
  // coverage for.
  useEffect(() => {
    if (!leaveTypeCode || leaveTypeCode === "OTHER" || leaveTypeCode === "SH" || !fromDate || !toDate || toDate < fromDate) {
      setPeriods([]);
      setSubstituteByPeriod({});
      setSubstituteDeptFilter("");
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
        setSubstituteDeptFilter("");
      })
      .catch(() => {
        if (!cancelled) setPeriods([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPeriods(false);
      });
    return () => { cancelled = true; };
  }, [leaveTypeCode, fromDate, toDate]);

  // Every department any period's candidates actually belong to - not a
  // fetched department list, so "All Departments" never offers a choice that
  // would just show "None available" everywhere.
  const substituteDepartments = Array.from(
    new Set(periods.flatMap((p) => p.candidates.map((c) => c.facultyDepartment).filter((d): d is string => !!d)))
  ).sort((a, b) => a.localeCompare(b));

  // Narrowing the department filter can hide someone already picked for a
  // period - clear just that pick rather than leave a Select showing a value
  // that's no longer one of its rendered options.
  useEffect(() => {
    if (!substituteDeptFilter) return;
    setSubstituteByPeriod((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const p of periods) {
        const key = `${p.date}|${p.timetableSlotId}`;
        const pickedId = next[key];
        if (!pickedId) continue;
        const stillVisible = p.candidates.some((c) => c.facultyId === pickedId && c.facultyDepartment === substituteDeptFilter);
        if (!stillVisible) { delete next[key]; changed = true; }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [substituteDeptFilter]);

  // Re-fetched whenever the dates change: the list is role-specific (see
  // lib/leave/handoverPool.ts) and, once a range is picked, leaves out anyone
  // who's on leave or tied up in it. A previously picked contact who drops out
  // of the new list is cleared rather than silently submitted.
  useEffect(() => {
    const range = fromDate && toDate && toDate >= fromDate ? `?fromDate=${fromDate}&toDate=${toDate}` : "";
    let cancelled = false;
    fetch(`/api/leave/handover-candidates${range}`)
      .then((r) => r.json() as Promise<{ candidates?: { uid: string; name: string }[] }>)
      .then((d) => {
        if (cancelled) return;
        const list = d.candidates ?? [];
        setHandoverCandidates(list);
        setHandoverToUid((current) => (current && !list.some((c) => c.uid === current) ? "" : current));
      })
      .catch(() => { /* Handover picker just stays empty - it's optional */ });
    return () => { cancelled = true; };
  }, [fromDate, toDate]);

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
        // Extend picks its own From (day after the original ends) and, for
        // SH, its own To below - both independent of the one-day/range
        // toggle, so show the pair rather than have the toggle collapse them.
        setFullDayMode("RANGE");
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

  const [editSource, setEditSource] = useState<LeaveRequest | null>(null);
  useEffect(() => {
    if (!editId) return;
    fetch(`/api/leave/applications/${editId}`)
      .then((r) => r.json() as Promise<{ request?: LeaveRequest; error?: string }>)
      .then((data) => {
        if (!data.request) { toast({ variant: "destructive", title: "Couldn't load this leave request" }); return; }
        const r = data.request;
        setEditSource(r);
        setFullDayMode("RANGE");
        setLeaveTypeCode(r.isOtherRequest && !r.leaveTypeCode ? "OTHER" : r.leaveTypeCode ?? "OTHER");
        setFromDate(isoDateKey(toJsDate(r.fromDate) ?? new Date()));
        setToDate(isoDateKey(toJsDate(r.toDate) ?? new Date()));
        setIsHalfDay(!!r.isHalfDay);
        if (r.halfDaySession) setHalfDaySession(r.halfDaySession);
        setReason(r.reason ?? "");
        setPlaceOfVisit(r.placeOfVisit ?? "");
        setPointOfContact(r.pointOfContact ?? "");
      })
      .catch(() => toast({ variant: "destructive", title: "Couldn't load this leave request" }));
  }, [editId]);

  // Once this edit's own periods load for the pre-filled dates (the effect
  // above), carry over whichever substitute was already picked for each one
  // - otherwise every period would come up unpicked even when nothing about
  // it actually changed. Only pre-fills a period whose candidate list still
  // includes that same person; one who's no longer available is left for the
  // requester to re-pick, same as if they'd never picked anyone.
  useEffect(() => {
    if (!editSource?.periodSubstitutions?.length || periods.length === 0) return;
    // Deferred the same way LeaveProfileView's own load() effects are -
    // setSubstituteByPeriod isn't reachable synchronously from the effect
    // body (react-hooks/set-state-in-effect).
    void (async () => {
      const byKey = new Map(editSource.periodSubstitutions!.map((p) => [`${p.date}|${p.timetableSlotId}`, p.substituteFacultyId]));
      setSubstituteByPeriod((prev) => {
        const next = { ...prev };
        for (const p of periods) {
          const key = `${p.date}|${p.timetableSlotId}`;
          const picked = byKey.get(key);
          if (picked && p.candidates.some((c) => c.facultyId === picked)) next[key] = picked;
        }
        return next;
      });
    })();
    // editSource is loaded once and never changes after; only re-run when a
    // fresh `periods` fetch actually lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periods]);

  async function handleSubmit() {
    if (!fromDate || !toDate || !reason.trim() || !leaveTypeCode) {
      toast({ variant: "destructive", title: "All fields are required" });
      return;
    }
    // Summer Vacation defaults to College Office's own declared range but can
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
            ? "No days remain in the declared Summer Vacation range"
            : "Summer Vacation dates must fall within your College Office's declared range",
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
    if (leaveTypeCode === "OD" && (!placeOfVisit.trim() || !pointOfContact.trim())) {
      toast({ variant: "destructive", title: "Place of visit and point of contact are required for On Duty" });
      return;
    }
    setIsSubmitting(true);
    try {
      const periodSubstitutions = periods.length > 0
        ? periods.map((p) => ({
            date: p.date,
            timetableSlotId: p.timetableSlotId,
            substituteFacultyId: substituteByPeriod[`${p.date}|${p.timetableSlotId}`],
          }))
        : undefined;
      const res = editId
        ? await fetch(`/api/leave/applications/${editId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "EDIT",
              fromDate,
              toDate,
              isHalfDay,
              halfDaySession: isHalfDay ? effectiveHalfDaySession : undefined,
              reason: reason.trim(),
              placeOfVisit: placeOfVisit.trim() || undefined,
              pointOfContact: pointOfContact.trim() || undefined,
              periodSubstitutions,
            }),
          })
        : await fetch("/api/leave/applications", {
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
              handoverToUid: HANDOVER_ENABLED ? (handoverToUid || undefined) : undefined,
              placeOfVisit: placeOfVisit.trim() || undefined,
              pointOfContact: pointOfContact.trim() || undefined,
              periodSubstitutions,
            }),
          });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to submit");
      toast({ variant: "success", title: editId ? "Leave request updated" : "Leave request submitted" });
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
        title={editId ? "Edit Leave Request" : extendId ? "Extend Leave" : "Apply for Leave"}
        description={
          editId ? "Editable until an approver acts on it"
            : extendId ? "Request more days on an already-approved leave" : "Submit a new leave request"
        }
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
            <Select value={leaveTypeCode} onValueChange={handleLeaveTypeChange} disabled={isLoadingTypes || !!extendId || !!editId}>
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
            {/* Set the expectation before they apply, not after they're
                already overdue. Shared by all 17 apply routes for free. */}
            {leaveTypeCode === "OD" && (
              <p className="text-xs text-muted-foreground">
                You&rsquo;ll need to upload proof of duty (certificate, letter or order) within {OD_PROOF_GRACE_DAYS}{" "}
                days of this On Duty period ending. Unproven days are treated as Loss of Pay.
              </p>
            )}
            {/* Available on every leave type - required only for OD (see the
                submit validation and applications/route.ts), optional
                elsewhere as a general "how do we reach you" pair. */}
            <div className="grid gap-3 sm:grid-cols-2 pt-1">
              <div className="space-y-1.5">
                <Label htmlFor="place-of-visit" className="text-xs">Place{leaveTypeCode === "OD" ? " of Visit" : ""}</Label>
                <Input
                  id="place-of-visit"
                  value={placeOfVisit}
                  onChange={(e) => setPlaceOfVisit(e.target.value)}
                  placeholder="e.g. XYZ College, Hyderabad"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="point-of-contact" className="text-xs">Point of Contact{leaveTypeCode !== "OD" ? " (optional)" : ""}</Label>
                <Input
                  id="point-of-contact"
                  value={pointOfContact}
                  onChange={(e) => setPointOfContact(e.target.value)}
                  placeholder="Name and phone number"
                />
              </div>
            </div>
            {/* Informational only - the server (applications/route.ts POST)
                is the actual enforcement, this just avoids a surprise 400
                after filling in the rest of the form. */}
            {(selectedType?.maxConsecutiveDays !== undefined || selectedType?.minAdvanceNoticeDays !== undefined) && (
              <p className="text-xs text-muted-foreground">
                {selectedType.maxConsecutiveDays !== undefined && `Max ${selectedType.maxConsecutiveDays} consecutive day(s). `}
                {selectedType.minAdvanceNoticeDays !== undefined && `Requires at least ${selectedType.minAdvanceNoticeDays} day(s) advance notice.`}
              </p>
            )}
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
            {/* Full day's own sub-choice: a single date, or a From/To span.
                Summer Vacation and Extend force RANGE above since both pick
                their own multi-day default (see handleLeaveTypeChange /
                the extend-fetch effect). */}
            {!isHalfDay && (
              <SegmentedTabs
                value={fullDayMode}
                onChange={(v) => handleFullDayModeChange(v as "ONE" | "RANGE")}
                options={[
                  { key: "ONE", label: "One day" },
                  { key: "RANGE", label: "More than one day" },
                ]}
              />
            )}
          </div>

          <div className={isHalfDay || fullDayMode === "ONE" ? "grid grid-cols-1 gap-3" : "grid grid-cols-2 gap-3"}>
            <div className="space-y-2">
              <Label>{isHalfDay || fullDayMode === "ONE" ? "Date" : "From"}</Label>
              <Input
                type="date"
                value={fromDate}
                min={leaveTypeCode === "SH" && summerHoliday ? summerHoliday.fromISO : todayISO}
                max={leaveTypeCode === "SH" && summerHoliday ? summerHoliday.toISO : undefined}
                onChange={(e) => handleFromDateChange(e.target.value)}
              />
            </div>
            {/* Half day and Full day's "One day" mode are both that same
                single date - To stays locked equal to From under the hood
                (see handleFromDateChange/handleDurationModeChange/
                handleFullDayModeChange) and is still sent as such on submit,
                just not shown here since there's nothing to actually pick. */}
            {!isHalfDay && fullDayMode === "RANGE" && (
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
                Pick a substitute for each period you&rsquo;d otherwise teach on this leave. Anyone free that period is listed, across departments - your own department comes first.
              </p>
              {substituteDepartments.length > 1 && (
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-muted-foreground shrink-0">Department</Label>
                  <Select value={substituteDeptFilter || "ALL"} onValueChange={(v) => setSubstituteDeptFilter(v === "ALL" ? "" : v)}>
                    <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All Departments</SelectItem>
                      {substituteDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="rounded-lg border p-3">
                <PeriodCoverageGrid
                  periods={periods}
                  renderPeriod={(p, key) => {
                    const candidates = substituteDeptFilter
                      ? p.candidates.filter((c) => c.facultyDepartment === substituteDeptFilter)
                      : p.candidates;
                    return (
                      <div key={key} className="space-y-1 rounded-md border p-2">
                        <p className="text-xs font-medium leading-tight">Period {p.periodNumber}</p>
                        <p className="text-xs leading-tight">
                          {p.subjectName}
                          {p.sectionName && <span className="text-muted-foreground"> · {p.sectionName}</span>}
                        </p>
                        {p.startTime && p.endTime && (
                          <p className="text-xs text-muted-foreground leading-tight">
                            {formatTime12h(p.startTime)}&ndash;{formatTime12h(p.endTime)}
                          </p>
                        )}
                        <Select
                          value={substituteByPeriod[key] ?? ""}
                          onValueChange={(v) => setSubstituteByPeriod((prev) => ({ ...prev, [key]: v }))}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder={candidates.length === 0 ? "None available" : "Select faculty"} />
                          </SelectTrigger>
                          <SelectContent>
                            {candidates.map((c) => (
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
                    );
                  }}
                />
              </div>
            </div>
          )}

          {HANDOVER_ENABLED && handoverCandidates.length > 0 && (
            <div className="space-y-2">
              <Label>Handover / point of contact (optional)</Label>
              <p className="text-xs text-muted-foreground">
                Name someone to handle anything else you look after while you&rsquo;re out - separate from any classes above.
                Only people available on your dates are listed.
              </p>
              <Select value={handoverToUid || "NONE"} onValueChange={(v) => setHandoverToUid(v === "NONE" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  {handoverCandidates.map((c) => (
                    <SelectItem key={c.uid} value={c.uid}>{c.name}</SelectItem>
                  ))}
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
            {selectedType?.reasonOptions?.length ? (
              <>
                <Select
                  value={customReasonMode ? "OTHER" : reason}
                  onValueChange={(v) => {
                    if (v === "OTHER") { setCustomReasonMode(true); setReason(""); }
                    else { setCustomReasonMode(false); setReason(v); }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select a reason" /></SelectTrigger>
                  <SelectContent>
                    {selectedType.reasonOptions.map((r) => <SelectItem key={r.label} value={r.label}>{r.label}</SelectItem>)}
                    {selectedType.allowCustomReason && <SelectItem value="OTHER">Other</SelectItem>}
                  </SelectContent>
                </Select>
                {customReasonMode && (
                  <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Describe your reason" />
                )}
              </>
            ) : (
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} placeholder="Reason for leave" />
            )}
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
