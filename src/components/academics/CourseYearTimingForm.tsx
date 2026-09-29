"use client";

import { useEffect, useState } from "react";
import { Plus, X, Clock, CalendarRange, Coffee, CheckCircle2, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros, toDateInputValue } from "@/lib/utils";
import type { BreakConfig, CourseYearTiming } from "@/types";

type SemesterRangeForm = { semester: number; startDate: string; endDate: string }; // dates are "YYYY-MM-DD"

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// Every period back-to-back plus every break's duration, wherever it falls -
// the same shape defaultPeriodTimings (lib/timetable/buildGrid.ts) lays the
// day out in, just summed instead of walked period-by-period, so this stays
// correct even while a break's "After Period #" temporarily points past the
// current period count mid-edit.
function requiredMinutes(f: Pick<TimingForm, "numberOfPeriods" | "periodDurationMinutes" | "lunchBreak" | "shortBreaks">): number {
  const periods = Number(f.numberOfPeriods) || 0;
  const perPeriod = Number(f.periodDurationMinutes) || 0;
  const breaksTotal = (f.lunchBreak?.durationMinutes || 0) + f.shortBreaks.reduce((sum, sb) => sum + (sb.durationMinutes || 0), 0);
  return periods * perPeriod + breaksTotal;
}

type TimingForm = {
  collegeStartTime: string;
  collegeEndTime: string;
  numberOfPeriods: string;
  periodDurationMinutes: string;
  lunchBreak: BreakConfig;
  shortBreaks: BreakConfig[];
  numberOfSemesters: string;
  semesters: SemesterRangeForm[];
};

const EMPTY_TIMING_FORM: TimingForm = {
  collegeStartTime: "09:00",
  collegeEndTime: "16:30",
  numberOfPeriods: "7",
  periodDurationMinutes: "50",
  lunchBreak: { afterPeriod: 4, durationMinutes: 40 },
  shortBreaks: [],
  numberOfSemesters: "0",
  semesters: [],
};

// Rebuilds the semesters array to exactly `count` rows, numbered 1..count in
// order - the row count is now the single source of truth for how many
// semesters this course-year has (Office picks the count first), so a
// semester's own number is no longer freely typed and can't end up
// duplicated or out of sequence. Existing rows keep whatever dates they
// already had (by position); growing the count appends blank new rows,
// shrinking it drops from the end.
function resizeSemesters(current: SemesterRangeForm[], count: number, year: number = 1): SemesterRangeForm[] {
  const next = current.slice(0, count).map((s, i) => ({
    ...s,
    semester: s.semester || (year > 1 ? (year - 1) * 2 + (i + 1) : i + 1),
  }));
  for (let i = next.length; i < count; i++) {
    const defaultSem = year > 1 ? (year - 1) * 2 + (i + 1) : i + 1;
    next.push({ semester: defaultSem, startDate: "", endDate: "" });
  }
  return next;
}

interface CourseYearTimingFormProps {
  departmentId: string;
  courseId: string;
  year: number;
  // Called after a successful save - the caller decides where "back" means
  // (Principal's own department page vs Office's Department/Course/Year
  // picker), rather than this shared form hardcoding a redirect.
  onSaved: () => void;
  onCancel: () => void;
}

// The "set the college day's overall bounds" form (start/end time, period
// count/length, lunch + short breaks) POSTed to /api/college/course-year-
// timings - shared by whichever roles can set it (Principal always;
// COLLEGE_OFFICE too, see that route's own role list) so the form only
// exists once. The HOD-only period-by-period clock-time breakdown (PATCH,
// filled in on top of these bounds) is a separate, finer-grained privilege
// not part of this form - see hod/timetable's own editor for that.
export function CourseYearTimingForm({ departmentId, courseId, year, onSaved, onCancel }: CourseYearTimingFormProps) {
  const [timingForm, setTimingForm] = useState<TimingForm>(EMPTY_TIMING_FORM);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  // The current academic session's own dates, when the Principal has set
  // them (AcademicSession.startDate/endDate - optional). Used only for the
  // submit-time bounds check below; the server (course-year-timings POST)
  // enforces the same rule regardless, this is just earlier feedback.
  const [sessionBounds, setSessionBounds] = useState<{ label?: string; startDate: string; endDate: string } | null>(null);

  useEffect(() => {
    fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions?: { label?: string; isCurrent?: boolean; startDate?: string; endDate?: string }[] }>)
      .then((d) => {
        const current = (d.academicSessions ?? []).find((s) => s.isCurrent);
        if (current?.startDate && current?.endDate) {
          setSessionBounds({ label: current.label, startDate: current.startDate, endDate: current.endDate });
        }
      })
      .catch(() => { /* non-critical - falls back to server-side-only enforcement */ });
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`);
        const data = await res.json() as { timings: CourseYearTiming[] };
        const existing = (data.timings ?? []).find((t) => t.year === year);
        setTimingForm(
          existing
            ? {
                collegeStartTime: existing.collegeStartTime,
                collegeEndTime: existing.collegeEndTime,
                numberOfPeriods: String(existing.numberOfPeriods),
                periodDurationMinutes: String(existing.periodDurationMinutes),
                lunchBreak: existing.lunchBreak,
                shortBreaks: existing.shortBreaks ?? [],
                numberOfSemesters: String((existing.semesters ?? []).length),
                semesters: (existing.semesters ?? [])
                  .slice()
                  .sort((a, b) => a.semester - b.semester)
                  .map((s) => ({
                    semester: s.semester,
                    startDate: toDateInputValue(s.startDate),
                    endDate: toDateInputValue(s.endDate),
                  })),
              }
            : EMPTY_TIMING_FORM
        );
      } catch {
        toast({ variant: "destructive", title: "Failed to load timings" });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [courseId, year]);

  function addShortBreak() {
    setTimingForm((f) => ({ ...f, shortBreaks: [...f.shortBreaks, { afterPeriod: 1, durationMinutes: 10 }] }));
  }
  function updateShortBreak(idx: number, patch: Partial<BreakConfig>) {
    setTimingForm((f) => {
      const next = [...f.shortBreaks];
      next[idx] = { ...next[idx], ...patch };
      return { ...f, shortBreaks: next };
    });
  }
  function removeShortBreak(idx: number) {
    setTimingForm((f) => ({ ...f, shortBreaks: f.shortBreaks.filter((_, i) => i !== idx) }));
  }

  function setNumberOfSemesters(value: string) {
    const count = Math.max(0, Number(value) || 0);
    setTimingForm((f) => ({ ...f, numberOfSemesters: String(count), semesters: resizeSemesters(f.semesters, count, year) }));
  }
  function updateSemester(idx: number, patch: Partial<SemesterRangeForm>) {
    setTimingForm((f) => {
      const next = [...f.semesters];
      next[idx] = { ...next[idx], ...patch };
      return { ...f, semesters: next };
    });
  }

  // Available window is only meaningful once both clock times are set and
  // End is actually after Start - a blank/backwards window can't be judged
  // "does it fit", so the fit check is skipped (not falsely flagged) until then.
  const availableMinutes = timingForm.collegeStartTime && timingForm.collegeEndTime
    ? toMinutes(timingForm.collegeEndTime) - toMinutes(timingForm.collegeStartTime)
    : null;
  const totalRequiredMinutes = requiredMinutes(timingForm);
  const exceedsAvailableTime = availableMinutes !== null && availableMinutes > 0 && totalRequiredMinutes > availableMinutes;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!timingForm.numberOfPeriods || !timingForm.periodDurationMinutes) {
      toast({ variant: "destructive", title: "Number of periods and period duration are required" });
      return;
    }
    if (availableMinutes !== null && availableMinutes <= 0) {
      toast({ variant: "destructive", title: "College End Time must be after College Start Time" });
      return;
    }
    if (exceedsAvailableTime) {
      toast({
        variant: "destructive",
        title: "Periods and breaks don't fit in the college day",
        description: `They need ${formatDuration(totalRequiredMinutes)}, but only ${formatDuration(availableMinutes ?? 0)} is available between ${timingForm.collegeStartTime} and ${timingForm.collegeEndTime}.`,
      });
      return;
    }
    if (timingForm.semesters.some((s) => !s.startDate || !s.endDate)) {
      toast({ variant: "destructive", title: "Every semester needs both a start and end date" });
      return;
    }
    if (timingForm.semesters.some((s) => s.startDate > s.endDate)) {
      toast({ variant: "destructive", title: "A semester's end date can't be before its start date" });
      return;
    }
    if (sessionBounds) {
      const outOfBounds = timingForm.semesters.find(
        (s) => s.startDate < sessionBounds.startDate || s.endDate > sessionBounds.endDate
      );
      if (outOfBounds) {
        toast({
          variant: "destructive",
          title: `Semester ${outOfBounds.semester} falls outside the ${sessionBounds.label ?? "current"} academic year`,
          description: `Academic year runs ${sessionBounds.startDate} to ${sessionBounds.endDate}.`,
        });
        return;
      }
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/course-year-timings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId,
          courseId,
          year,
          collegeStartTime: timingForm.collegeStartTime,
          collegeEndTime: timingForm.collegeEndTime,
          numberOfPeriods: Number(timingForm.numberOfPeriods),
          periodDurationMinutes: Number(timingForm.periodDurationMinutes),
          lunchBreak: timingForm.lunchBreak,
          shortBreaks: timingForm.shortBreaks,
          semesters: timingForm.semesters,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save timings");
      }
      toast({ variant: "success", title: `Timings saved for Year ${year}` });
      onSaved();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save timings" });
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column (7 cols): College Schedule & Periods */}
        <div className="lg:col-span-7 space-y-6">
          <Card className="rounded-xl border shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                College Hours & Periods
              </CardTitle>
              <CardDescription>
                Define the overall college day start/end times and individual period lengths.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>College Start Time</Label>
                  <Input
                    type="time"
                    value={timingForm.collegeStartTime}
                    onChange={(e) => setTimingForm((f) => ({ ...f, collegeStartTime: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>College End Time</Label>
                  <Input
                    type="time"
                    value={timingForm.collegeEndTime}
                    onChange={(e) => setTimingForm((f) => ({ ...f, collegeEndTime: e.target.value }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Number of Teaching Periods</Label>
                  <Input
                    type="number"
                    min={1}
                    value={timingForm.numberOfPeriods}
                    onChange={(e) => setTimingForm((f) => ({ ...f, numberOfPeriods: stripLeadingZeros(e.target.value) }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Period Duration (minutes)</Label>
                  <Input
                    type="number"
                    min={1}
                    value={timingForm.periodDurationMinutes}
                    onChange={(e) => setTimingForm((f) => ({ ...f, periodDurationMinutes: stripLeadingZeros(e.target.value) }))}
                  />
                </div>
              </div>

              {/* Day Time Budget Card */}
              <div
                className={`rounded-lg border p-3.5 text-xs ${
                  exceedsAvailableTime
                    ? "border-destructive/50 bg-destructive/10 text-destructive"
                    : "border-border/60 bg-muted/20 text-muted-foreground"
                }`}
              >
                <div className="flex items-center gap-2">
                  {exceedsAvailableTime ? (
                    <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
                  )}
                  <p>
                    Periods + breaks total: <strong className="text-foreground">{formatDuration(totalRequiredMinutes)}</strong>
                    {availableMinutes !== null && availableMinutes > 0 && (
                      <> of <strong className="text-foreground">{formatDuration(availableMinutes)}</strong> available ({timingForm.collegeStartTime} – {timingForm.collegeEndTime})</>
                    )}
                  </p>
                </div>
                {exceedsAvailableTime && (
                  <p className="mt-1.5 pl-6 font-medium text-destructive">
                    Exceeds the college day by {formatDuration(totalRequiredMinutes - (availableMinutes ?? 0))}. Please adjust periods or breaks.
                  </p>
                )}
                {availableMinutes !== null && availableMinutes <= 0 && (
                  <p className="mt-1.5 pl-6 font-medium text-destructive">College End Time must be after College Start Time.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Breaks & Recess Card */}
          <Card className="rounded-xl border shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <Coffee className="h-4 w-4 text-primary" />
                Lunch & Recess Breaks
              </CardTitle>
              <CardDescription>
                Configure midday lunch break and any scheduled short recess breaks.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label className="font-semibold text-xs text-foreground uppercase tracking-wider">Lunch Break</Label>
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/15">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">After Period #</p>
                    <Input
                      type="number"
                      min={1}
                      value={timingForm.lunchBreak.afterPeriod}
                      onChange={(e) => setTimingForm((f) => ({ ...f, lunchBreak: { ...f.lunchBreak, afterPeriod: Number(e.target.value) } }))}
                    />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Duration (minutes)</p>
                    <Input
                      type="number"
                      min={1}
                      value={timingForm.lunchBreak.durationMinutes}
                      onChange={(e) => setTimingForm((f) => ({ ...f, lunchBreak: { ...f.lunchBreak, durationMinutes: Number(e.target.value) } }))}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t border-border/50">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold text-xs text-foreground uppercase tracking-wider">Short Recess Breaks</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addShortBreak} className="h-7 text-xs">
                    <Plus className="h-3 w-3 mr-1" />Add Short Break
                  </Button>
                </div>
                {timingForm.shortBreaks.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-1">No short breaks configured for this year.</p>
                ) : (
                  <div className="space-y-2">
                    {timingForm.shortBreaks.map((sb, idx) => (
                      <div key={idx} className="flex items-center gap-2 rounded-lg border bg-muted/15 p-2.5">
                        <div className="flex-1 grid grid-cols-2 gap-2">
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">After Period #</p>
                            <Input
                              type="number"
                              min={1}
                              value={sb.afterPeriod}
                              onChange={(e) => updateShortBreak(idx, { afterPeriod: Number(e.target.value) })}
                            />
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Duration (minutes)</p>
                            <Input
                              type="number"
                              min={1}
                              value={sb.durationMinutes}
                              onChange={(e) => updateShortBreak(idx, { durationMinutes: Number(e.target.value) })}
                            />
                          </div>
                        </div>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeShortBreak(idx)}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column (5 cols): Semesters & Calendar Ranges */}
        <div className="lg:col-span-5 space-y-6">
          <Card className="rounded-xl border shadow-xs">
            <CardHeader className="pb-4">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarRange className="h-4 w-4 text-primary" />
                Semester Calendar Ranges
              </CardTitle>
              <CardDescription>
                Define start and end dates for each semester of Year {year}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {sessionBounds && (
                <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{sessionBounds.label ?? "Academic Session"}:</span> {sessionBounds.startDate} to {sessionBounds.endDate}
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="num-semesters">Number of Semesters in Year {year}</Label>
                <Input
                  id="num-semesters"
                  type="number"
                  min={0}
                  max={6}
                  value={timingForm.numberOfSemesters}
                  onChange={(e) => setNumberOfSemesters(stripLeadingZeros(e.target.value))}
                  className="max-w-[12rem]"
                />
              </div>

              {timingForm.semesters.length === 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">
                  0 semesters configured. Enter a number above to define semester durations.
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  {timingForm.semesters.map((s, idx) => (
                    <div key={idx} className="rounded-lg border bg-card p-3.5 space-y-2 shadow-2xs">
                      <div className="flex items-center justify-between pb-1 border-b border-border/40">
                        <span className="text-xs font-bold text-foreground">Semester #{s.semester}</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-muted-foreground">Sem No:</span>
                          <Input
                            type="number"
                            min={1}
                            max={12}
                            className="h-6 w-14 text-xs text-center px-1 py-0 font-bold"
                            value={s.semester}
                            onChange={(e) => updateSemester(idx, { semester: Math.max(1, Number(e.target.value) || 1) })}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">Start Date</Label>
                          <Input
                            type="date"
                            value={s.startDate}
                            onChange={(e) => updateSemester(idx, { startDate: e.target.value })}
                            className="text-xs"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px] text-muted-foreground">End Date</Label>
                          <Input
                            type="date"
                            value={s.endDate}
                            onChange={(e) => updateSemester(idx, { endDate: e.target.value })}
                            className="text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Sticky Bottom Actions Bar */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t bg-background">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          loading={isSaving}
          disabled={exceedsAvailableTime || (availableMinutes !== null && availableMinutes <= 0)}
          className="min-w-[120px]"
        >
          Save Timings
        </Button>
      </div>
    </form>
  );
}
