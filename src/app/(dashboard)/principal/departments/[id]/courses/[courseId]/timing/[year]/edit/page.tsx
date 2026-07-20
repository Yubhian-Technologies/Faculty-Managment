"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Plus, X, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import type { BreakConfig, Course, CourseYearTiming } from "@/types";

type TimingForm = {
  collegeStartTime: string;
  collegeEndTime: string;
  numberOfPeriods: string;
  periodDurationMinutes: string;
  lunchBreak: BreakConfig;
  shortBreaks: BreakConfig[];
};

const EMPTY_TIMING_FORM: TimingForm = {
  collegeStartTime: "09:00",
  collegeEndTime: "16:30",
  numberOfPeriods: "7",
  periodDurationMinutes: "50",
  lunchBreak: { afterPeriod: 4, durationMinutes: 40 },
  shortBreaks: [],
};

export default function CourseYearTimingPage() {
  const router = useRouter();
  const { id, courseId, year } = useParams<{ id: string; courseId: string; year: string }>();
  const yearNum = Number(year);

  const [course, setCourse] = useState<Course | null>(null);
  const [timingForm, setTimingForm] = useState<TimingForm>(EMPTY_TIMING_FORM);
  const [loading, setLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [coursesRes, timingsRes] = await Promise.all([
          fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`).then((r) => r.json() as Promise<{ courses: Course[] }>),
          fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`).then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
        ]);
        const c = (coursesRes.courses ?? []).find((x) => x.id === courseId) ?? null;
        setCourse(c);

        const existing = (timingsRes.timings ?? []).find((t) => t.year === yearNum);
        setTimingForm(
          existing
            ? {
                collegeStartTime: existing.collegeStartTime,
                collegeEndTime: existing.collegeEndTime,
                numberOfPeriods: String(existing.numberOfPeriods),
                periodDurationMinutes: String(existing.periodDurationMinutes),
                lunchBreak: existing.lunchBreak,
                shortBreaks: existing.shortBreaks ?? [],
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
  }, [id, courseId, yearNum]);

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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!timingForm.numberOfPeriods || !timingForm.periodDurationMinutes) {
      toast({ variant: "destructive", title: "Number of periods and period duration are required" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/course-year-timings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: id,
          courseId,
          year: yearNum,
          collegeStartTime: timingForm.collegeStartTime,
          collegeEndTime: timingForm.collegeEndTime,
          numberOfPeriods: Number(timingForm.numberOfPeriods),
          periodDurationMinutes: Number(timingForm.periodDurationMinutes),
          lunchBreak: timingForm.lunchBreak,
          shortBreaks: timingForm.shortBreaks,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save timings");
      }
      toast({ variant: "success", title: `Timings saved for ${course?.name ?? "course"} — Year ${yearNum}` });
      router.push(`/principal/departments/${id}`);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save timings" });
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Course Timings" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={`${course?.name ?? "Course"} — Year ${yearNum} Timings`}
        description="Set college hours, periods and breaks for this course-year"
      />

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

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={isSaving}>Save Timings</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
