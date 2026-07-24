"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Course, Section, Subject, TeachingAssignment } from "@/types";

type SectionRow = Section & { id: string };
type FacultyOption = { id: string; name: string; designation: string };
type SubjectRow = Subject & { id: string };

const STUDENT_FACULTY_RATIO = 15;

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

type SectionForm = {
  courseId: string;
  name: string;
  year: string;
  batch: string;
  studentCount: number | "";
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

const EMPTY_FORM: SectionForm = {
  courseId: "", name: "", year: "", batch: "", studentCount: "", facultyInchargeUid: "", facultyInchargeName: "",
};

export default function EditSectionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [form, setForm] = useState<SectionForm>(EMPTY_FORM);
  const [sectionName, setSectionName] = useState("");

  // Subjects & faculty (per-subject teaching assignments for this section)
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [originalFaculty, setOriginalFaculty] = useState<Record<string, string>>({}); // subjectId -> facultyId
  const [stagedFaculty, setStagedFaculty] = useState<Record<string, string>>({});
  const assignmentIdBySubject = useRef<Record<string, string>>({});

  const loadSubjects = useCallback((courseId: string, year: string) => {
    if (!courseId || !year) { setSubjects([]); return; }
    setSubjectsLoading(true);
    fetch(`/api/college/subjects?courseId=${courseId}&year=${year}`)
      .then((r) => r.json() as Promise<{ subjects?: SubjectRow[] }>)
      .then((d) => setSubjects(d.subjects ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load subjects" }))
      .finally(() => setSubjectsLoading(false));
  }, []);

  useEffect(() => {
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));

    fetch("/api/college/faculty?status=ACTIVE")
      .then((r) => r.json())
      .then((d: { faculty?: { id: string; name: string; designation: string }[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({ id: f.id, name: f.name, designation: f.designation })));
      })
      .catch(() => { /* non-critical */ });

    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections: SectionRow[] }>)
      .then((d) => {
        const s = (d.sections ?? []).find((x) => x.id === sectionId);
        if (!s) {
          toast({ variant: "destructive", title: "Section not found" });
          router.push("/hod/sections");
          return;
        }
        setSectionName(s.name);
        setForm({
          courseId: s.courseId ?? "",
          name: s.name,
          year: String(s.year),
          batch: s.batch,
          studentCount: s.studentCount ?? "",
          facultyInchargeUid: s.facultyInchargeUid ?? "",
          facultyInchargeName: s.facultyInchargeName ?? "",
        });
        loadSubjects(s.courseId ?? "", String(s.year));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load section" }))
      .finally(() => setLoading(false));

    fetch(`/api/college/teaching-assignments?sectionId=${sectionId}`)
      .then((r) => r.json() as Promise<{ assignments?: (TeachingAssignment & { id: string })[] }>)
      .then((d) => {
        const faculty: Record<string, string> = {};
        const ids: Record<string, string> = {};
        (d.assignments ?? []).forEach((a) => {
          faculty[a.subjectId] = a.facultyId;
          ids[a.subjectId] = a.id;
        });
        assignmentIdBySubject.current = ids;
        setOriginalFaculty(faculty);
        setStagedFaculty(faculty);
      })
      .catch(() => { /* non-critical */ });
  }, [sectionId, router, loadSubjects]);

  function setF(patch: Partial<SectionForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function handleSubjectFacultyChange(subjectId: string, facultyId: string) {
    setStagedFaculty((s) => {
      const next = { ...s };
      if (facultyId) next[subjectId] = facultyId; else delete next[subjectId];
      return next;
    });
  }

  async function syncSubjectFaculty(): Promise<string[]> {
    const errors: string[] = [];
    for (const subj of subjects) {
      const before = originalFaculty[subj.id] ?? "";
      const after = stagedFaculty[subj.id] ?? "";
      if (before === after) continue;

      const assignmentId = assignmentIdBySubject.current[subj.id];
      try {
        if (assignmentId) {
          await fetch(`/api/college/teaching-assignments/${assignmentId}`, { method: "DELETE" });
        }
        if (after) {
          const fac = facultyList.find((f) => f.id === after);
          const res = await fetch("/api/college/teaching-assignments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              facultyId: after,
              facultyName: fac?.name ?? "",
              courseId: form.courseId,
              sectionId,
              subjectId: subj.id,
              hoursPerWeek: subj.hoursPerWeek,
            }),
          });
          if (!res.ok) {
            const j = (await res.json().catch(() => ({}))) as { error?: string };
            errors.push(`${subj.name}: ${j.error ?? "failed to assign faculty"}`);
          }
        }
      } catch {
        errors.push(`${subj.name}: network error while saving faculty`);
      }
    }
    return errors;
  }

  function handleFacultySelect(facultyId: string) {
    if (!facultyId) {
      setF({ facultyInchargeUid: "", facultyInchargeName: "" });
      return;
    }
    const f = facultyList.find((x) => x.id === facultyId);
    setF({ facultyInchargeUid: facultyId, facultyInchargeName: f?.name ?? "" });
  }

  const formCourse = useMemo(() => courses.find((c) => c.id === form.courseId) ?? null, [courses, form.courseId]);
  const formYearOptions = useMemo(
    () => (formCourse ? Array.from({ length: formCourse.durationYears }, (_, i) => i + 1) : []),
    [formCourse]
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.courseId) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Section name is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Year is required" }); return; }
    if (!form.batch.trim()) { toast({ variant: "destructive", title: "Batch is required (e.g. 2023-2027)" }); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/college/sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: form.courseId,
          name: form.name,
          year: Number(form.year),
          batch: form.batch,
          studentCount: form.studentCount === "" ? 0 : Number(form.studentCount),
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }

      const facultyErrors = await syncSubjectFaculty();
      if (facultyErrors.length) {
        toast({
          variant: "destructive",
          title: "Section saved, but some faculty assignments failed",
          description: facultyErrors.join("; "),
        });
      } else {
        toast({ variant: "success", title: "Section updated" });
      }
      router.push("/hod/sections");
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Section" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title={`Edit Section ${sectionName}`}
        description="Update this section's details"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Section Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Course *</Label>
              <Select
                value={form.courseId}
                onValueChange={(v) => { setF({ courseId: v, year: "" }); setSubjects([]); }}
              >
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Section Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setF({ name: e.target.value.toUpperCase() })}
                  placeholder="A, B, C…"
                  maxLength={5}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">e.g. A, B, C or CS-A</p>
              </div>
              <div className="space-y-2">
                <Label>Year *</Label>
                <Select
                  value={form.year}
                  onValueChange={(v) => { setF({ year: v }); loadSubjects(form.courseId, v); }}
                  disabled={!formCourse}
                >
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {formYearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Batch *</Label>
              <Input
                value={form.batch}
                onChange={(e) => setF({ batch: e.target.value })}
                placeholder="e.g. 2023-2027"
              />
              <p className="text-xs text-muted-foreground">Admission year to passout year</p>
            </div>

            <div className="space-y-2">
              <Label>Student Intake</Label>
              <Input
                type="number"
                min={0}
                value={form.studentCount}
                onChange={(e) => setF({ studentCount: e.target.value === "" ? "" : Number(e.target.value) })}
                placeholder="e.g. 60"
              />
              {form.studentCount !== "" && Number(form.studentCount) > 0 && (
                <p className="text-xs text-blue-600 font-medium">
                  Faculty required (1:{STUDENT_FACULTY_RATIO} ratio): {Math.ceil(Number(form.studentCount) / STUDENT_FACULTY_RATIO)}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Faculty Incharge</Label>
              <Select
                value={form.facultyInchargeUid || "none"}
                onValueChange={(v) => handleFacultySelect(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select faculty incharge" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— Not assigned —</SelectItem>
                  {facultyList.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {facultyList.length === 0 && (
                <p className="text-xs text-muted-foreground">No active faculty found in your department.</p>
              )}
            </div>

            <div className="space-y-3 pt-4 border-t">
              <Label>Subjects & Faculty</Label>
              {!form.courseId || !form.year ? (
                <p className="text-xs text-muted-foreground">Select a course and year to assign faculty per subject.</p>
              ) : subjectsLoading ? (
                <p className="text-xs text-muted-foreground">Loading subjects…</p>
              ) : subjects.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No subjects defined yet for {formCourse?.name} · {ordinalYear(Number(form.year))}. Add subjects first.
                </p>
              ) : (
                <div className="space-y-2">
                  {subjects.map((subj) => (
                    <div key={subj.id} className="flex items-center gap-3 rounded-md border p-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{subj.name}</p>
                        <p className="text-xs text-muted-foreground">{subj.code} · {subj.hoursPerWeek} hrs/week</p>
                      </div>
                      <Select
                        value={stagedFaculty[subj.id] || "none"}
                        onValueChange={(v) => handleSubjectFacultyChange(subj.id, v === "none" ? "" : v)}
                      >
                        <SelectTrigger className="w-48">
                          <SelectValue placeholder="Assign faculty" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— Unassigned —</SelectItem>
                          {facultyList.map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Save Changes</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
