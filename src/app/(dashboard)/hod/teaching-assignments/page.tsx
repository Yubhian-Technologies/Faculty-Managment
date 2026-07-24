"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Course, Section, Subject, TeachingAssignment, FacultyMember } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function TeachingAssignmentsPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Shared course/year context for both the staffing-gap finder and the assign-faculty form.
  const [courseId, setCourseId] = useState("");
  const [year, setYear] = useState("");
  const [sectionsCache, setSectionsCache] = useState<Record<string, Section[]>>({});
  const [subjectsCache, setSubjectsCache] = useState<Record<string, Subject[]>>({});

  const [assignForm, setAssignForm] = useState({ sectionId: "", subjectId: "", facultyId: "" });
  const [savingAssignment, setSavingAssignment] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>).then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name)))),
      fetch("/api/college/faculty?status=ACTIVE").then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>).then((d) => setFaculty(d.faculty ?? [])),
      fetch("/api/college/teaching-assignments?dept=true").then((r) => r.json() as Promise<{ assignments: TeachingAssignment[] }>).then((d) => setAssignments(d.assignments ?? [])),
    ])
      .catch(() => toast({ variant: "destructive", title: "Failed to load teaching data" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const key = `${courseId}_${year}`;
  const sections = useMemo(() => sectionsCache[key] ?? [], [sectionsCache, key]);
  const subjects = useMemo(() => subjectsCache[key] ?? [], [subjectsCache, key]);
  const course = courses.find((c) => c.id === courseId) ?? null;
  const yearOptions = course ? Array.from({ length: course.durationYears }, (_, i) => i + 1) : [];

  async function ensureCourseYearData(cId: string, y: string) {
    const k = `${cId}_${y}`;
    if (!(k in sectionsCache)) {
      const res = await fetch(`/api/college/sections?courseId=${encodeURIComponent(cId)}&year=${y}`);
      const d = await res.json() as { sections: Section[] };
      setSectionsCache((c) => ({ ...c, [k]: d.sections ?? [] }));
    }
    if (!(k in subjectsCache)) {
      const res = await fetch(`/api/college/subjects?courseId=${encodeURIComponent(cId)}&year=${y}`);
      const d = await res.json() as { subjects: Subject[] };
      setSubjectsCache((c) => ({ ...c, [k]: d.subjects ?? [] }));
    }
  }

  function handleCourseChange(v: string) {
    setCourseId(v);
    setYear("");
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
  }

  async function handleYearChange(v: string) {
    setYear(v);
    setAssignForm({ sectionId: "", subjectId: "", facultyId: "" });
    await ensureCourseYearData(courseId, v);
  }

  // Which subject/section combos for the selected course+year have no faculty assigned yet.
  const gapRows = useMemo(() => {
    if (!courseId || !year) return [];
    return subjects.map((subject) => {
      const staffedSectionIds = new Set(
        assignments
          .filter((a) => a.subjectId === subject.id && a.courseId === courseId && a.year === Number(year))
          .map((a) => a.sectionId)
      );
      const unstaffedSections = sections.filter((s) => !staffedSectionIds.has(s.id));
      return { subject, unstaffedSections };
    });
  }, [subjects, sections, assignments, courseId, year]);

  // Subjects already staffed for the section picked in the assign-faculty form shouldn't be
  // offered again there — pick a different subject or remove the existing assignment first.
  const availableSubjectsForAssign = assignForm.sectionId
    ? subjects.filter((s) => !assignments.some((a) => a.sectionId === assignForm.sectionId && a.subjectId === s.id))
    : subjects;

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!courseId || !year || !assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId) return;
    setSavingAssignment(true);
    try {
      const fac = faculty.find((f) => f.id === assignForm.facultyId);
      const subj = subjects.find((s) => s.id === assignForm.subjectId);
      const res = await fetch("/api/college/teaching-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId: assignForm.facultyId,
          facultyName: fac?.name ?? "",
          courseId,
          sectionId: assignForm.sectionId,
          subjectId: assignForm.subjectId,
          hoursPerWeek: subj?.hoursPerWeek,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to assign", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Faculty assigned" });
      setAssignForm({ sectionId: assignForm.sectionId, subjectId: "", facultyId: "" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingAssignment(false);
    }
  }

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/college/teaching-assignments?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Assignment removed" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to remove assignment" });
    }
  }

  // Group current assignments by course → year → section for display. Any assignment
  // missing that context (shouldn't happen going forward, but data can be old) falls into
  // its own bucket rather than silently disappearing.
  const { groups, ungrouped } = useMemo(() => {
    const map = new Map<string, { courseName: string; year: number; sectionName: string; items: TeachingAssignment[] }>();
    const ungrouped: TeachingAssignment[] = [];
    for (const a of assignments) {
      if (!a.courseId || a.year == null || !a.sectionId) { ungrouped.push(a); continue; }
      const k = `${a.courseId}_${a.year}_${a.sectionId}`;
      if (!map.has(k)) map.set(k, { courseName: a.courseName ?? "Course", year: a.year, sectionName: a.sectionName ?? "", items: [] });
      map.get(k)!.items.push(a);
    }
    const groups = Array.from(map.values()).sort(
      (x, y) => x.courseName.localeCompare(y.courseName) || x.year - y.year || x.sectionName.localeCompare(y.sectionName)
    );
    return { groups, ungrouped };
  }, [assignments]);

  return (
    <div className="space-y-6">
      <PageHeader title="Teaching Assignments" description="Find staffing gaps and assign faculty to subjects, course &amp; year wise" />

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Course &amp; Year</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-md">
            <div className="space-y-2">
              <Label>Course</Label>
              <Select value={courseId} onValueChange={handleCourseChange}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Year</Label>
              <Select value={year} onValueChange={(v) => void handleYearChange(v)} disabled={!course}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Unstaffed Subjects</CardTitle></CardHeader>
          <CardContent>
            {!courseId || !year ? (
              <p className="text-sm text-muted-foreground text-center py-6">Select a course and year above to see staffing gaps.</p>
            ) : subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No subjects defined yet for {course?.name} · {ordinalYear(Number(year))}.</p>
            ) : sections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No sections created yet for {course?.name} · {ordinalYear(Number(year))}.</p>
            ) : (
              <div className="space-y-3">
                {gapRows.map(({ subject, unstaffedSections }) => (
                  <div key={subject.id} className="rounded-md border p-2.5">
                    <p className="text-sm font-medium">{subject.name} <span className="text-muted-foreground">({subject.code})</span></p>
                    {unstaffedSections.length === 0 ? (
                      <Badge variant="approved" className="mt-1.5">Fully staffed</Badge>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {unstaffedSections.map((s) => (
                          <Badge key={s.id} variant="rejected">Section {s.name} unstaffed</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Assign Faculty</CardTitle></CardHeader>
          <CardContent>
            {!courseId || !year ? (
              <p className="text-sm text-muted-foreground text-center py-6">Select a course and year above to assign faculty.</p>
            ) : (
              <form onSubmit={handleAssign} className="space-y-3">
                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select
                    value={assignForm.sectionId}
                    onValueChange={(v) => setAssignForm({ sectionId: v, subjectId: "", facultyId: "" })}
                  >
                    <SelectTrigger><SelectValue placeholder={sections.length ? "Select section" : "No sections for this year"} /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => <SelectItem key={s.id} value={s.id}>Section {s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select
                    value={assignForm.subjectId}
                    onValueChange={(v) => setAssignForm((f) => ({ ...f, subjectId: v }))}
                    disabled={!assignForm.sectionId}
                  >
                    <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>
                      {availableSubjectsForAssign.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">All subjects already staffed for this section</div>
                      )}
                      {availableSubjectsForAssign.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Faculty</Label>
                  <Select
                    value={assignForm.facultyId}
                    onValueChange={(v) => setAssignForm((f) => ({ ...f, facultyId: v }))}
                    disabled={!assignForm.subjectId}
                  >
                    <SelectTrigger><SelectValue placeholder={faculty.length ? "Select faculty" : "No faculty in your department"} /></SelectTrigger>
                    <SelectContent>
                      {faculty.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="submit"
                  loading={savingAssignment}
                  disabled={!assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId}
                >
                  Assign
                </Button>
                <p className="text-xs text-muted-foreground">
                  Periods for this subject are picked afterwards from the faculty member&rsquo;s Edit page.
                </p>
              </form>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Current Assignments</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No teaching assignments yet.</p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={`${g.courseName}_${g.year}_${g.sectionName}`}>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    {g.courseName} · {ordinalYear(g.year)} · Section {g.sectionName}
                  </p>
                  <div className="divide-y rounded-md border">
                    {g.items.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2.5 px-3">
                        <div>
                          <p className="text-sm font-medium">{a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span></p>
                          <p className="text-xs text-muted-foreground">{a.facultyName} · {a.hoursPerWeek} hrs/wk</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => void handleRemove(a.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {ungrouped.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Ungrouped</p>
                  <div className="divide-y rounded-md border">
                    {ungrouped.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2.5 px-3">
                        <div>
                          <p className="text-sm font-medium">{a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span></p>
                          <p className="text-xs text-muted-foreground">
                            {a.facultyName}
                            {a.academicYear ? ` · ${a.academicYear}` : ""}
                            {a.semester ? ` · Sem ${a.semester}` : ""}
                            {a.section ? ` · Sec ${a.section}` : ""}
                            {" "}· {a.hoursPerWeek} hrs/wk
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => void handleRemove(a.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
