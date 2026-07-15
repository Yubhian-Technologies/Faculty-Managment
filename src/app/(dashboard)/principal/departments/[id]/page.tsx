"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Plus, Pencil, Trash2, Clock, GraduationCap, CheckCircle2, X, CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { Department, Course, CourseYearTiming, BreakConfig, AcademicYear } from "@/types";

// "2025-2026" -> "2026-2027"; falls back to blank if the label isn't in that shape.
function suggestNextLabel(label: string): string {
  const match = /^(\d{4})\s*-\s*(\d{4})$/.exec(label.trim());
  if (!match) return "";
  return `${Number(match[1]) + 1}-${Number(match[2]) + 1}`;
}

type CourseForm = { name: string; code: string; durationYears: string };
const EMPTY_COURSE_FORM: CourseForm = { name: "", code: "", durationYears: "4" };

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

export default function DepartmentDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [department, setDepartment] = useState<Department | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [academicYears, setAcademicYears] = useState<AcademicYear[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [courseDialogOpen, setCourseDialogOpen] = useState(false);
  const [editingCourse, setEditingCourse] = useState<Course | null>(null);
  const [courseForm, setCourseForm] = useState<CourseForm>(EMPTY_COURSE_FORM);
  const [isSavingCourse, setIsSavingCourse] = useState(false);
  const [deletingCourse, setDeletingCourse] = useState<Course | null>(null);

  const [timingDialogOpen, setTimingDialogOpen] = useState(false);
  const [timingDialogCourse, setTimingDialogCourse] = useState<Course | null>(null);
  const [timingDialogYear, setTimingDialogYear] = useState<number | null>(null);
  const [timingForm, setTimingForm] = useState<TimingForm>(EMPTY_TIMING_FORM);
  const [isSavingTiming, setIsSavingTiming] = useState(false);

  const [academicYearDialogOpen, setAcademicYearDialogOpen] = useState(false);
  const [academicYearDialogCourse, setAcademicYearDialogCourse] = useState<Course | null>(null);
  const [academicYearDialogYear, setAcademicYearDialogYear] = useState<number | null>(null);
  const [academicYearLabel, setAcademicYearLabel] = useState("");
  const [isSavingAcademicYear, setIsSavingAcademicYear] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [deptRes, coursesRes] = await Promise.all([
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch(`/api/college/courses?departmentId=${encodeURIComponent(id)}`).then((r) => r.json() as Promise<{ courses: Course[] }>),
      ]);
      const dept = (deptRes.departments ?? []).find((d) => d.id === id) ?? null;
      setDepartment(dept);
      const sortedCourses = (coursesRes.courses ?? []).sort((a, b) => a.name.localeCompare(b.name));
      setCourses(sortedCourses);

      const [timingLists, academicYearLists] = await Promise.all([
        Promise.all(
          sortedCourses.map((c) =>
            fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(c.id)}`)
              .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>)
              .then((d) => d.timings ?? [])
          )
        ),
        Promise.all(
          sortedCourses.map((c) =>
            fetch(`/api/college/academic-years?courseId=${encodeURIComponent(c.id)}`)
              .then((r) => r.json() as Promise<{ academicYears: AcademicYear[] }>)
              .then((d) => d.academicYears ?? [])
          )
        ),
      ]);
      setTimings(timingLists.flat());
      setAcademicYears(academicYearLists.flat());
    } catch {
      toast({ variant: "destructive", title: "Failed to load department" });
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  function getTiming(courseId: string, year: number): CourseYearTiming | undefined {
    return timings.find((t) => t.courseId === courseId && t.year === year);
  }

  function getAcademicYear(courseId: string, year: number): AcademicYear | undefined {
    return academicYears.find((a) => a.courseId === courseId && a.year === year);
  }

  function openAddCourse() {
    setEditingCourse(null);
    setCourseForm(EMPTY_COURSE_FORM);
    setCourseDialogOpen(true);
  }

  function openEditCourse(c: Course) {
    setEditingCourse(c);
    setCourseForm({ name: c.name, code: c.code, durationYears: String(c.durationYears) });
    setCourseDialogOpen(true);
  }

  async function handleSaveCourse() {
    if (!courseForm.name.trim() || !courseForm.code.trim() || !courseForm.durationYears) {
      toast({ variant: "destructive", title: "Name, code and duration are required" });
      return;
    }
    setIsSavingCourse(true);
    try {
      const payload = {
        departmentId: id,
        name: courseForm.name.trim(),
        code: courseForm.code.trim(),
        durationYears: Number(courseForm.durationYears),
      };
      const url = editingCourse ? `/api/college/courses/${editingCourse.id}` : "/api/college/courses";
      const method = editingCourse ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed to save course");
      }
      toast({ variant: "success", title: editingCourse ? "Course updated" : "Course added" });
      setCourseDialogOpen(false);
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save course" });
    } finally {
      setIsSavingCourse(false);
    }
  }

  async function handleDeleteCourse() {
    if (!deletingCourse) return;
    try {
      const res = await fetch(`/api/college/courses/${deletingCourse.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete course");
      toast({ variant: "success", title: `${deletingCourse.name} removed` });
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete course" });
    } finally {
      setDeletingCourse(null);
    }
  }

  function openTimingDialog(course: Course, year: number) {
    const existing = getTiming(course.id, year);
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
    setTimingDialogCourse(course);
    setTimingDialogYear(year);
    setTimingDialogOpen(true);
  }

  async function handleSaveTiming() {
    if (!timingDialogCourse || !timingDialogYear) return;
    if (!timingForm.numberOfPeriods || !timingForm.periodDurationMinutes) {
      toast({ variant: "destructive", title: "Number of periods and period duration are required" });
      return;
    }
    setIsSavingTiming(true);
    try {
      const res = await fetch("/api/college/course-year-timings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: id,
          courseId: timingDialogCourse.id,
          year: timingDialogYear,
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
      toast({ variant: "success", title: `Timings saved for ${timingDialogCourse.name} — Year ${timingDialogYear}` });
      setTimingDialogOpen(false);
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save timings" });
    } finally {
      setIsSavingTiming(false);
    }
  }

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

  function openAcademicYearDialog(course: Course, year: number) {
    const existing = getAcademicYear(course.id, year);
    setAcademicYearLabel(existing ? suggestNextLabel(existing.label) : "");
    setAcademicYearDialogCourse(course);
    setAcademicYearDialogYear(year);
    setAcademicYearDialogOpen(true);
  }

  async function handleSaveAcademicYear() {
    if (!academicYearDialogCourse || !academicYearDialogYear) return;
    if (!academicYearLabel.trim()) {
      toast({ variant: "destructive", title: "Academic year label is required" });
      return;
    }
    setIsSavingAcademicYear(true);
    try {
      const res = await fetch("/api/college/academic-years", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: id,
          courseId: academicYearDialogCourse.id,
          year: academicYearDialogYear,
          label: academicYearLabel.trim(),
        }),
      });
      const json = await res.json() as { error?: string; advanced?: boolean; facultyUpdated?: number };
      if (!res.ok) throw new Error(json.error ?? "Failed to save academic year");
      toast({
        variant: "success",
        title: json.advanced
          ? `Advanced to ${academicYearLabel.trim()} — ${json.facultyUpdated ?? 0} faculty member${json.facultyUpdated === 1 ? "" : "s"} updated`
          : `Academic year set for ${academicYearDialogCourse.name} — Year ${academicYearDialogYear}`,
      });
      setAcademicYearDialogOpen(false);
      await load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save academic year" });
    } finally {
      setIsSavingAcademicYear(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={department?.name ?? "Department"}
        description={department ? `${department.code} · Manage courses and their timings` : "Loading…"}
        actions={
          <Button variant="outline" onClick={() => router.push("/principal/departments")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back to Departments
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <GraduationCap className="h-4 w-4" />Courses
            </CardTitle>
            <Button size="sm" onClick={openAddCourse}>
              <Plus className="h-4 w-4 mr-2" />Add Course
            </Button>
          </CardHeader>
          <CardContent>
            {courses.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No courses yet. Add the courses offered by this department.
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {courses.map((c) => {
                  const years = Array.from({ length: c.durationYears }, (_, i) => i + 1);
                  return (
                    <div key={c.id} className="rounded-lg border p-3 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <Badge variant="secondary" className="text-xs font-mono mb-1">{c.code}</Badge>
                          <p className="font-semibold text-sm">{c.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{c.durationYears} year{c.durationYears !== 1 ? "s" : ""}</p>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditCourse(c)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDeletingCourse(c)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1.5 border-t pt-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Timings by Year</p>
                        {years.map((y) => {
                          const t = getTiming(c.id, y);
                          return (
                            <button
                              key={y}
                              type="button"
                              onClick={() => openTimingDialog(c, y)}
                              className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                            >
                              <span className="flex items-center gap-1.5">
                                <Clock className="h-3 w-3 text-muted-foreground shrink-0" />
                                Year {y}
                              </span>
                              {t ? (
                                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {t.collegeStartTime}–{t.collegeEndTime} · {t.numberOfPeriods} periods
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Not configured — tap to add</span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      <div className="space-y-1.5 border-t pt-2">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">Academic Year</p>
                        {years.map((y) => {
                          const ay = getAcademicYear(c.id, y);
                          return (
                            <button
                              key={y}
                              type="button"
                              onClick={() => openAcademicYearDialog(c, y)}
                              className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
                            >
                              <span className="flex items-center gap-1.5">
                                <CalendarClock className="h-3 w-3 text-muted-foreground shrink-0" />
                                Year {y}
                              </span>
                              {ay ? (
                                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                                  <CheckCircle2 className="h-3 w-3" />
                                  {ay.label} — tap to advance
                                </span>
                              ) : (
                                <span className="text-muted-foreground">Not set — tap to add</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add / Edit Course Dialog */}
      <Dialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editingCourse ? "Edit Course" : "Add Course"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Course Name *</Label>
              <Input
                value={courseForm.name}
                onChange={(e) => setCourseForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. B.Pharm, BDS, B.Tech"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Short Code *</Label>
              <Input
                value={courseForm.code}
                onChange={(e) => setCourseForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
                placeholder="e.g. BTECH"
                className="uppercase"
                maxLength={10}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Duration (Years) *</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={courseForm.durationYears}
                onChange={(e) => setCourseForm((f) => ({ ...f, durationYears: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCourseDialogOpen(false)} disabled={isSavingCourse}>Cancel</Button>
            <Button onClick={() => void handleSaveCourse()} loading={isSavingCourse}>
              {editingCourse ? "Save Changes" : "Add Course"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / Edit Timing Dialog */}
      <Dialog open={timingDialogOpen} onOpenChange={setTimingDialogOpen}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {timingDialogCourse?.name} — Year {timingDialogYear} Timings
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>College Start Time</Label>
                <Input
                  type="time"
                  value={timingForm.collegeStartTime}
                  onChange={(e) => setTimingForm((f) => ({ ...f, collegeStartTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>College End Time</Label>
                <Input
                  type="time"
                  value={timingForm.collegeEndTime}
                  onChange={(e) => setTimingForm((f) => ({ ...f, collegeEndTime: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Number of Periods</Label>
                <Input
                  type="number"
                  min={1}
                  value={timingForm.numberOfPeriods}
                  onChange={(e) => setTimingForm((f) => ({ ...f, numberOfPeriods: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Period Duration (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  value={timingForm.periodDurationMinutes}
                  onChange={(e) => setTimingForm((f) => ({ ...f, periodDurationMinutes: e.target.value }))}
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
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeShortBreak(idx)}>
                    <X className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setTimingDialogOpen(false)} disabled={isSavingTiming}>Cancel</Button>
            <Button onClick={() => void handleSaveTiming()} loading={isSavingTiming}>
              Save Timings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set / Advance Academic Year Dialog */}
      <Dialog open={academicYearDialogOpen} onOpenChange={setAcademicYearDialogOpen}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              <span className="flex items-center gap-2">
                <CalendarClock className="h-4 w-4" />
                {academicYearDialogCourse?.name} — Year {academicYearDialogYear} Academic Year
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            {academicYearDialogCourse && academicYearDialogYear && getAcademicYear(academicYearDialogCourse.id, academicYearDialogYear) ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                Currently <strong>{getAcademicYear(academicYearDialogCourse.id, academicYearDialogYear)?.label}</strong>. Saving a new label here
                will be treated as advancing the academic year — every active faculty member with a teaching assignment in this course/year will have
                their Total Experience and Internal Experience increased by 1 year.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                First-time setup — this just records the current academic year for this course/year. No experience will be changed.
              </p>
            )}
            <div className="space-y-1.5">
              <Label>Academic Year Label</Label>
              <Input
                value={academicYearLabel}
                onChange={(e) => setAcademicYearLabel(e.target.value)}
                placeholder="e.g. 2025-2026"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAcademicYearDialogOpen(false)} disabled={isSavingAcademicYear}>Cancel</Button>
            <Button onClick={() => void handleSaveAcademicYear()} loading={isSavingAcademicYear}>
              {academicYearDialogCourse && academicYearDialogYear && getAcademicYear(academicYearDialogCourse.id, academicYearDialogYear) ? "Advance" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deletingCourse}
        onOpenChange={(open) => !open && setDeletingCourse(null)}
        title={`Delete ${deletingCourse?.name ?? "course"}?`}
        description="This will permanently remove the course. Courses with existing sections cannot be deleted."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDeleteCourse()}
      />
    </div>
  );
}
