"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Plus, Pencil, Trash2, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { Course, Subject } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function HODSubjectsPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);

  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [selectedYear, setSelectedYear] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<Subject | null>(null);

  const loadCourses = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/courses");
      const data = await res.json() as { courses: Course[] };
      setCourses((data.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)));
    } catch {
      toast({ variant: "destructive", title: "Failed to load courses" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadCourses(); }, [loadCourses]);

  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) ?? null, [courses, selectedCourseId]);
  const yearOptions = useMemo(
    () => (selectedCourse ? Array.from({ length: selectedCourse.durationYears }, (_, i) => i + 1) : []),
    [selectedCourse]
  );

  const loadSubjects = useCallback(async (courseId: string, year: string) => {
    if (!courseId || !year) { setSubjects([]); return; }
    setIsLoadingSubjects(true);
    try {
      const res = await fetch(`/api/college/subjects?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`);
      const data = await res.json() as { subjects: Subject[] };
      setSubjects(data.subjects ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load subjects" });
    } finally {
      setIsLoadingSubjects(false);
    }
  }, []);

  function selectCourse(courseId: string) {
    setSelectedCourseId(courseId);
    setSelectedYear("");
    setSubjects([]);
  }

  function selectYear(year: string) {
    setSelectedYear(year);
    void loadSubjects(selectedCourseId, year);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/college/subjects/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to delete subject");
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      await loadSubjects(selectedCourseId, selectedYear);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete subject" });
    } finally {
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Manage subjects offered for each year of your department's courses — common to all sections of that year"
      />

      {isLoading ? (
        <div className="h-28 rounded-lg border bg-muted/30 animate-pulse" />
      ) : courses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No courses have been set up for your department yet. Ask the Principal to add courses under Departments first.
        </div>
      ) : (
        <>
          <Card>
            <CardContent className="p-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Course</Label>
                <Select value={selectedCourseId} onValueChange={selectCourse}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Year</Label>
                <Select value={selectedYear} onValueChange={selectYear} disabled={!selectedCourse}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {selectedCourseId && selectedYear && (
            <Card>
              <CardContent className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold text-sm flex items-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    {selectedCourse?.name} · {ordinalYear(Number(selectedYear))}
                  </h2>
                  <Button size="sm" onClick={() => router.push(`/hod/subjects/new?courseId=${selectedCourseId}&year=${selectedYear}`)}>
                    <Plus className="h-4 w-4 mr-2" />Add Subject
                  </Button>
                </div>

                {isLoadingSubjects ? (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg border bg-muted/30 animate-pulse" />)}
                  </div>
                ) : subjects.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-6 text-center">
                    No subjects added yet for this year.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {subjects.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <Badge variant="secondary" className="text-xs font-mono">{s.code}</Badge>
                            <Badge variant="outline" className="text-xs">{SUBJECT_TYPE_LABELS[s.type]}</Badge>
                          </div>
                          <p className="font-medium text-sm">{s.name}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{s.hoursPerWeek} hrs/week</span>
                            {s.totalHoursPerSemester != null && <span>{s.totalHoursPerSemester} hrs/semester</span>}
                            {s.credits > 0 && <span>{s.credits} credits</span>}
                          </div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => router.push(`/hod/subjects/${s.id}/edit?courseId=${selectedCourseId}&year=${selectedYear}`)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setDeleteTarget(s)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name ?? "subject"}?`}
        description="This will permanently remove the subject."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
