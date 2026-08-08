"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { AcademicSession, Course, Department } from "@/types";

type FacultyOption = { id: string; name: string; designation: string };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Derives the admission batch (e.g. "2023-2027") from the college's current
// academic session (e.g. "2025-26"), the section's year-of-study, and the
// course's total duration - a Year-2 section in a 4-year course during the
// 2025-26 session was admitted in 2024 and passes out in 2028.
function computeBatch(currentSessionLabel: string, durationYears: number, sectionYear: number): string {
  const startYear = parseInt(currentSessionLabel.slice(0, 4), 10);
  if (!Number.isFinite(startYear)) return "";
  const admissionYear = startYear - (sectionYear - 1);
  return `${admissionYear}-${admissionYear + durationYears}`;
}

type SectionForm = {
  departmentId: string;
  secondaryDepartment: string;
  courseId: string;
  name: string;
  year: string;
  batch: string;
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

type ClassLeaderForm = {
  email: string;
  password: string;
};

const EMPTY_CLASS_LEADER: ClassLeaderForm = { email: "", password: "" };

export default function NewSectionOfficePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCourseId = searchParams.get("courseId") ?? "";
  const prefilledDepartmentId = searchParams.get("departmentId") ?? "";

  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [currentSession, setCurrentSession] = useState<AcademicSession | null>(null);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [form, setForm] = useState<SectionForm>({
    departmentId: "",
    secondaryDepartment: "",
    courseId: prefilledCourseId,
    name: "",
    year: "",
    batch: "",
    facultyInchargeUid: "",
    facultyInchargeName: "",
  });
  const [classLeader, setClassLeader] = useState<ClassLeaderForm>(EMPTY_CLASS_LEADER);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }));

    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));

    fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions: AcademicSession[] }>)
      .then((d) => setCurrentSession((d.academicSessions ?? []).find((s) => s.isCurrent) ?? null))
      .catch(() => { /* non-critical - batch just won't auto-fill */ });
  }, []);

  // Pre-filling department from either a course link (e.g. "Add Section" from
  // a course's page) or a department-filtered link (e.g. "Add Section" from
  // the Sections list with a department tab active) - a single effect so the
  // two sources can never race and set `form.departmentId` to two different
  // values in the same tick. An explicit departmentId wins over one inferred
  // from a course, since it reflects the more specific filter the user was
  // actually looking at. Only applies once departments/courses have actually
  // loaded and contain a match, so the Select is never handed a `value` with
  // no corresponding item yet (Radix's Select gets stuck in an update loop
  // if that happens).
  useEffect(() => {
    if (form.departmentId) return;
    if (prefilledDepartmentId && departments.some((d) => d.id === prefilledDepartmentId)) {
      setForm((f) => (f.departmentId ? f : { ...f, departmentId: prefilledDepartmentId }));
      return;
    }
    if (prefilledCourseId) {
      const course = courses.find((c) => c.id === prefilledCourseId);
      if (course?.departmentId) {
        setForm((f) => (f.departmentId ? f : { ...f, departmentId: course.departmentId }));
      }
    }
  }, [departments, courses, prefilledDepartmentId, prefilledCourseId, form.departmentId]);

  const selectedDepartment = useMemo(
    () => departments.find((d) => d.id === form.departmentId) ?? null,
    [departments, form.departmentId]
  );
  const secondaryDepartmentOptions = useMemo(
    () => selectedDepartment?.secondaryDepartments ?? [],
    [selectedDepartment]
  );

  useEffect(() => {
    if (!selectedDepartment) { setFacultyList([]); return; }
    fetch(`/api/college/faculty?status=ACTIVE&department=${encodeURIComponent(selectedDepartment.name)}`)
      .then((r) => r.json())
      .then((d: { faculty?: { id: string; name: string; designation: string }[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({ id: f.id, name: f.name, designation: f.designation })));
      })
      .catch(() => { /* non-critical */ });
  }, [selectedDepartment]);

  function setF(patch: Partial<SectionForm>) {
    setForm((f) => ({ ...f, ...patch }));
  }

  function handleDepartmentChange(departmentId: string) {
    const dept = departments.find((d) => d.id === departmentId);
    const options = dept?.secondaryDepartments ?? [];
    setForm((f) => ({
      ...f,
      departmentId,
      secondaryDepartment: options.length === 1 ? options[0] : "",
      courseId: "",
      year: "",
      facultyInchargeUid: "",
      facultyInchargeName: "",
    }));
  }

  function handleFacultySelect(facultyId: string) {
    if (!facultyId) {
      setF({ facultyInchargeUid: "", facultyInchargeName: "" });
      return;
    }
    const f = facultyList.find((x) => x.id === facultyId);
    setF({ facultyInchargeUid: facultyId, facultyInchargeName: f?.name ?? "" });
  }

  // A sub-department (secondary department, e.g. "BS - Physics") never has
  // courses of its own - it's a specialization within its parent's program -
  // so fall back to the parent's courses too, otherwise the dropdown is
  // empty and a section can never be created for it.
  const coursesInDepartment = useMemo(() => {
    if (!form.departmentId) return [];
    const dept = departments.find((d) => d.id === form.departmentId);
    const departmentIds = new Set([form.departmentId, dept?.parentDepartmentId].filter(Boolean));
    return courses.filter((c) => departmentIds.has(c.departmentId));
  }, [courses, departments, form.departmentId]);
  const formCourse = useMemo(() => courses.find((c) => c.id === form.courseId) ?? null, [courses, form.courseId]);
  const formYearOptions = useMemo(
    () => (formCourse ? Array.from({ length: formCourse.durationYears }, (_, i) => i + 1) : []),
    [formCourse]
  );

  // Auto-fill the admission batch once course + year are both picked, instead
  // of asking Office to work it out and type it by hand.
  useEffect(() => {
    if (!formCourse || !form.year || !currentSession) return;
    const computed = computeBatch(currentSession.label, formCourse.durationYears, Number(form.year));
    if (computed) setForm((f) => ({ ...f, batch: computed }));
  }, [formCourse, form.year, currentSession]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.departmentId) { toast({ variant: "destructive", title: "Department is required" }); return; }
    if (!form.courseId) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Section name is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Year is required" }); return; }
    if (!form.batch.trim()) { toast({ variant: "destructive", title: "Batch is required (e.g. 2023-2027)" }); return; }
    if (secondaryDepartmentOptions.length > 0 && !form.secondaryDepartment) {
      toast({ variant: "destructive", title: "Secondary Department is required - pick which branch this section promotes into" });
      return;
    }
    const wantsClassLeader = classLeader.email.trim() || classLeader.password;
    if (wantsClassLeader) {
      if (!classLeader.email.trim() || !classLeader.password) {
        toast({ variant: "destructive", title: "Fill in both Class Leader fields, or leave them both blank" });
        return;
      }
      if (classLeader.password.length < 6) {
        toast({ variant: "destructive", title: "Class Leader password must be at least 6 characters" });
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch("/api/college/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: form.departmentId,
          secondaryDepartment: form.secondaryDepartment || undefined,
          courseId: form.courseId,
          name: form.name,
          year: Number(form.year),
          batch: form.batch,
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }
      const { id: newSectionId } = await res.json() as { id: string };

      if (wantsClassLeader) {
        const clRes = await fetch("/api/college/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: classLeader.email.trim(),
            password: classLeader.password,
            role: "CLASS_LEADER",
            sectionId: newSectionId,
          }),
        });
        if (!clRes.ok) {
          const clJson = await clRes.json() as { error?: string };
          toast({ variant: "destructive", title: "Section created, but Class Leader login failed", description: clJson.error ?? "You can add it later from the section's Edit page." });
          router.push("/college-office/sections");
          return;
        }
      }

      toast({ variant: "success", title: "Section created", description: wantsClassLeader ? "Class Leader login created too." : undefined });
      router.push("/college-office/sections");
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Add Section"
        description="Create a class section for any department across the college"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Section Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div key="department" className="space-y-2">
              <Label>Department *</Label>
              <Select value={form.departmentId} onValueChange={handleDepartmentChange}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>
                  {departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {selectedDepartment && secondaryDepartmentOptions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No secondary department cross-listing set for this department (configured by its HOD under Sub-Departments, or by Principal).
                </p>
              )}
            </div>

            {secondaryDepartmentOptions.length > 0 && (
              <div key="secondary-department" className="space-y-2">
                <Label>Secondary Department *</Label>
                <Select
                  value={form.secondaryDepartment || "none"}
                  onValueChange={(v) => setF({ secondaryDepartment: v === "none" ? "" : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Select secondary department" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">- None -</SelectItem>
                    {secondaryDepartmentOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Which branch this section&apos;s whole cohort promotes into next year - that branch&apos;s HOD gets
                  automatic view-only access to this section&apos;s students, roster, and assigned faculty.
                </p>
              </div>
            )}

            <div key="course" className="space-y-2">
              <Label>Course *</Label>
              <Select
                value={form.courseId}
                onValueChange={(v) => setF({ courseId: v, year: "" })}
                disabled={!form.departmentId}
              >
                <SelectTrigger>
                  <SelectValue placeholder={form.departmentId ? "Select course" : "Select a department first"} />
                </SelectTrigger>
                <SelectContent>
                  {coursesInDepartment.length === 0 && form.departmentId && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No courses set up for this department yet</div>
                  )}
                  {coursesInDepartment.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div key="name-year" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                <Select value={form.year} onValueChange={(v) => setF({ year: v })} disabled={!formCourse}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {formYearOptions.map((y) => (
                      <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div key="batch" className="space-y-2">
              <Label>Batch *</Label>
              <Input
                value={form.batch}
                onChange={(e) => setF({ batch: e.target.value })}
                placeholder="e.g. 2023-2027"
              />
              <p className="text-xs text-muted-foreground">
                {currentSession
                  ? `Admission year to passout year - auto-filled from the current academic session (${currentSession.label}); adjust if needed.`
                  : "Admission year to passout year - set a current Academic Session to auto-fill this."}
              </p>
            </div>

            <div key="faculty-incharge" className="space-y-2">
              <Label>Faculty Incharge</Label>
              <Select
                value={form.facultyInchargeUid || "none"}
                onValueChange={(v) => handleFacultySelect(v === "none" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select faculty incharge" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">- Not assigned -</SelectItem>
                  {facultyList.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div key="class-leader" className="space-y-4 pt-4 border-t">
              <div>
                <Label className="text-sm font-semibold">Class Leader Login (optional)</Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Create a login for this section&apos;s class leader now, or leave blank and add one later from Edit.
                  Just an email and password - the login isn&apos;t tied to a specific student&apos;s name, since who holds
                  the role can change per your college&apos;s rules.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  autoComplete="off"
                  value={classLeader.email}
                  onChange={(e) => setClassLeader((c) => ({ ...c, email: e.target.value }))}
                  placeholder="classleader@college.edu"
                />
              </div>
              <div className="space-y-2">
                <Label>Temporary Password</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={classLeader.password}
                  onChange={(e) => setClassLeader((c) => ({ ...c, password: e.target.value }))}
                  placeholder="Min 6 characters"
                />
              </div>
            </div>

            <div key="actions" className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Create Section</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
