"use client";

import { useEffect, useState } from "react";
import { Plus, X, Clock, CalendarRange } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros, toDateInputValue } from "@/lib/utils";
import type { BreakConfig, CourseYearTiming } from "@/types";

type SemesterRangeForm = { semester: number; startDate: string; endDate: string }; // dates are "YYYY-MM-DD"

type TimingForm = {
  collegeStartTime: string;
  collegeEndTime: string;
  numberOfPeriods: string;
  periodDurationMinutes: string;
  lunchBreak: BreakConfig;
  shortBreaks: BreakConfig[];
  semesters: SemesterRangeForm[];
};

const EMPTY_TIMING_FORM: TimingForm = {
  collegeStartTime: "09:00",
  collegeEndTime: "16:30",
  numberOfPeriods: "7",
  periodDurationMinutes: "50",
  lunchBreak: { afterPeriod: 4, durationMinutes: 40 },
  shortBreaks: [],
  semesters: [],
};

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

  function addSemester() {
    setTimingForm((f) => ({
      ...f,
      semesters: [...f.semesters, { semester: f.semesters.length + 1, startDate: "", endDate: "" }],
    }));
  }
  function updateSemester(idx: number, patch: Partial<SemesterRangeForm>) {
    setTimingForm((f) => {
      const next = [...f.semesters];
      next[idx] = { ...next[idx], ...patch };
      return { ...f, semesters: next };
    });
  }
  function removeSemester(idx: number) {
    setTimingForm((f) => ({ ...f, semesters: f.semesters.filter((_, i) => i !== idx) }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!timingForm.numberOfPeriods || !timingForm.periodDurationMinutes) {
      toast({ variant: "destructive", title: "Number of periods and period duration are required" });
      return;
    }
    if (timingForm.semesters.some((s) => !s.startDate || !s.endDate)) {
      toast({ variant: "destructive", title: "Every semester needs both a start and end date" });
      return;
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
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Timing Details
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
              <Label>Number of Periods</Label>
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

          <div className="space-y-2">
            <Label>Lunch Break</Label>
            <div className="grid grid-cols-2 gap-3">
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

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Short Breaks</Label>
              <Button type="button" variant="outline" size="sm" onClick={addShortBreak}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add Short Break
              </Button>
            </div>
            {timingForm.shortBreaks.length === 0 && (
              <p className="text-xs text-muted-foreground">No short breaks added.</p>
            )}
            {timingForm.shortBreaks.map((sb, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-md bg-muted/30 p-2">
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
                <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeShortBreak(idx)}>
                  <X className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <CalendarRange className="h-3.5 w-3.5" />
                Semester Durations
              </Label>
              <Button type="button" variant="outline" size="sm" onClick={addSemester}>
                <Plus className="h-3.5 w-3.5 mr-1" />Add Semester
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This year&rsquo;s semester date ranges - as many as this course actually runs. Which one is
              &ldquo;current&rdquo; for the timetable follows whichever semester today&rsquo;s date falls within.
            </p>
            {timingForm.semesters.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No semesters added yet - this year runs as one continuous timetable until at least one is added.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {timingForm.semesters.map((s, idx) => (
                  <div key={idx} className="space-y-1.5 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-xs">Semester #</Label>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeSemester(idx)}>
                        <X className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                    <Input
                      type="number"
                      min={1}
                      value={s.semester}
                      onChange={(e) => updateSemester(idx, { semester: Number(e.target.value) })}
                      className="w-20"
                    />
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">Start</p>
                        <Input
                          type="date"
                          value={s.startDate}
                          onChange={(e) => updateSemester(idx, { startDate: e.target.value })}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">End</p>
                        <Input
                          type="date"
                          value={s.endDate}
                          onChange={(e) => updateSemester(idx, { endDate: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
            <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
            <Button type="submit" loading={isSaving}>Save Timings</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
