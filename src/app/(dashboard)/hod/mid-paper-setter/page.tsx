"use client";

import { useEffect, useMemo, useState } from "react";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Course, MidNumber, MidPaperAssignment, Subject } from "@/types";

interface FacultyOption { id: string; name: string }

// Subjects/rosters are only ever tracked per academic Year, not per true
// semester - see attendance-percentage-report/route.ts's own note. Picking
// either semester of a year (e.g. 3 or 4) resolves to the same Year and
// shows the same subject list, same convention as the Attendance Reports
// page's own Semester picker.
function yearForSemester(semester: number): number {
  return Math.ceil(semester / 2);
}

export default function MidPaperSetterPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(true);

  const [courseName, setCourseName] = useState("");
  const [semester, setSemester] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [midNumber, setMidNumber] = useState<MidNumber>(1);
  const [facultyId, setFacultyId] = useState("");

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoadingSubjects, setIsLoadingSubjects] = useState(false);
  const [facultyOptions, setFacultyOptions] = useState<FacultyOption[]>([]);
  const [isLoadingFaculty, setIsLoadingFaculty] = useState(false);

  const [assignments, setAssignments] = useState<MidPaperAssignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);
  const [isAssigning, setIsAssigning] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoadingCourses(true);
      try {
        const res = await fetch("/api/college/courses");
        const data = (await res.json()) as { courses?: Course[] };
        setCourses(data.courses ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoadingCourses(false);
      }
    })();
  }, []);

  async function loadAssignments() {
    setIsLoadingAssignments(true);
    try {
      const res = await fetch("/api/college/mid-paper-assignments");
      const data = (await res.json()) as { assignments?: MidPaperAssignment[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load assignments");
      setAssignments(data.assignments ?? []);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load assignments" });
    } finally {
      setIsLoadingAssignments(false);
    }
  }

  useEffect(() => { void (async () => { await loadAssignments(); })(); }, []);

  const courseNameOptions = useMemo(() => [...new Set(courses.map((c) => c.name))].sort(), [courses]);
  const resolvedCourse = useMemo(() => courses.find((c) => c.name === courseName) ?? null, [courses, courseName]);
  const totalSemesters = (resolvedCourse?.durationYears ?? 0) * 2;
  const semesterOptions = useMemo(() => Array.from({ length: totalSemesters }, (_, i) => i + 1), [totalSemesters]);

  function resetDownstream(from: "course" | "semester" | "subject") {
    if (from === "course") { setSemester(""); setSubjectId(""); setFacultyId(""); }
    if (from === "semester") { setSubjectId(""); setFacultyId(""); }
    if (from === "subject") setFacultyId("");
  }

  useEffect(() => {
    void (async () => {
      if (!resolvedCourse || !semester) { setSubjects([]); return; }
      setIsLoadingSubjects(true);
      try {
        const params = new URLSearchParams({ courseId: resolvedCourse.id, year: String(yearForSemester(Number(semester))) });
        const res = await fetch(`/api/college/subjects?${params}`);
        const data = (await res.json()) as { subjects?: Subject[] };
        setSubjects(data.subjects ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load subjects" });
      } finally {
        setIsLoadingSubjects(false);
      }
    })();
  }, [resolvedCourse, semester]);

  useEffect(() => {
    void (async () => {
      if (!subjectId) { setFacultyOptions([]); return; }
      setIsLoadingFaculty(true);
      try {
        const params = new URLSearchParams({ subjectId, listFaculty: "true" });
        const res = await fetch(`/api/college/mid-paper-assignments?${params}`);
        const data = (await res.json()) as { faculty?: FacultyOption[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load faculty");
        setFacultyOptions(data.faculty ?? []);
      } catch (e) {
        toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load faculty" });
      } finally {
        setIsLoadingFaculty(false);
      }
    })();
  }, [subjectId]);

  async function assign() {
    if (!subjectId) { toast({ variant: "destructive", title: "Select a subject" }); return; }
    if (!facultyId) { toast({ variant: "destructive", title: "Select a faculty member" }); return; }
    setIsAssigning(true);
    try {
      const res = await fetch("/api/college/mid-paper-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, midNumber, facultyId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to assign");
      toast({ variant: "success", title: `Mid ${midNumber} question bank assigned` });
      setFacultyId("");
      await loadAssignments();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to assign" });
    } finally {
      setIsAssigning(false);
    }
  }

  const selectedSubject = subjects.find((s) => s.id === subjectId);

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Mid Paper Setter"
        description="Pick a subject and hand its Mid question-bank to one of the faculty currently teaching it. They'll see it on their own dashboard once assigned."
      />

      <Card>
        <CardContent className="pt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Course</Label>
            <Select value={courseName} onValueChange={(v) => { setCourseName(v); resetDownstream("course"); }} disabled={isLoadingCourses}>
              <SelectTrigger><SelectValue placeholder={isLoadingCourses ? "Loading…" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {courseNameOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Semester</Label>
            <Select value={semester} onValueChange={(v) => { setSemester(v); resetDownstream("semester"); }} disabled={!resolvedCourse}>
              <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
              <SelectContent>
                {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>{s}/{totalSemesters}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>Subject</Label>
            <Select value={subjectId} onValueChange={(v) => { setSubjectId(v); resetDownstream("subject"); }} disabled={!semester || isLoadingSubjects}>
              <SelectTrigger><SelectValue placeholder={isLoadingSubjects ? "Loading…" : "Select subject"} /></SelectTrigger>
              <SelectContent>
                {subjects.length === 0 && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">No subjects for this course/semester</div>
                )}
                {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Mid</Label>
            <RadioGroup value={String(midNumber)} onValueChange={(v) => setMidNumber(Number(v) as MidNumber)} className="flex gap-4 pt-1.5">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="1" id="mid-1" />
                <Label htmlFor="mid-1" className="font-normal">Mid 1</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="2" id="mid-2" />
                <Label htmlFor="mid-2" className="font-normal">Mid 2</Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>Faculty <span className="font-normal text-muted-foreground">(currently teaching this subject)</span></Label>
            <Select value={facultyId} onValueChange={setFacultyId} disabled={!subjectId || isLoadingFaculty}>
              <SelectTrigger><SelectValue placeholder={isLoadingFaculty ? "Loading…" : "Select faculty"} /></SelectTrigger>
              <SelectContent>
                {subjectId && facultyOptions.length === 0 && !isLoadingFaculty && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">Nobody is currently assigned to teach this subject</div>
                )}
                {facultyOptions.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={() => void assign()} loading={isAssigning} disabled={!subjectId || !facultyId}>
              <UserPlus className="h-4 w-4 mr-2" />
              Assign Mid {midNumber}{selectedSubject ? ` - ${selectedSubject.name}` : ""}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Current Assignments
          </h2>
          {isLoadingAssignments ? (
            <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No mid papers assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {assignments.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">{a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span></p>
                    <p className="text-xs text-muted-foreground">Assigned to {a.facultyName}</p>
                  </div>
                  <Badge variant="outline">Mid {a.midNumber}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
