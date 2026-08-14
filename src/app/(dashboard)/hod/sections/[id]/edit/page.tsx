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
import { buildCourseGroups } from "@/lib/departments/hodScope";
import type { Course, Department, Section, Subject, TeachingAssignment } from "@/types";

type SectionRow = Section & { id: string };
// `id` is the facultyMembers doc id — used for teachingAssignments.facultyId
// (per-subject "Subjects & Faculty" assignment below), which is keyed off
// the facultyMembers doc, not the login uid. `userUid` is the faculty
// member's actual Firebase Auth uid (set once HOD creates their login via
// "Set Login") — used only for Section.facultyInchargeUid, which sections
// queries match directly against session.uid.
type FacultyOption = { id: string; name: string; designation: string; department?: string; accessLevel?: "primary" | "secondary"; userUid?: string };
type SubjectRow = Subject & { id: string };

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

type SectionForm = {
  courseId: string;
  name: string;
  year: string;
  batch: string;
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

const EMPTY_FORM: SectionForm = {
  courseId: "", name: "", year: "", batch: "", facultyInchargeUid: "", facultyInchargeName: "",
};

export default function EditSectionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [form, setForm] = useState<SectionForm>(EMPTY_FORM);
  const [sectionName, setSectionName] = useState("");
  const [enrolledCount, setEnrolledCount] = useState(0);
  // Owning department name + the section's current target branch (if any), so
  // a shared-first-year section (e.g. Basic Science → CSE) can be re-pointed.
  const [ownerDept, setOwnerDept] = useState("");
  const [branch, setBranch] = useState("");

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
      .then((d: { faculty?: FacultyOption[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({
          id: f.id, name: f.name, designation: f.designation, department: f.department, accessLevel: f.accessLevel, userUid: f.userUid,
        })));
      })
      .catch(() => { /* non-critical */ });

    // Departments carry each department's configured branches
    // (secondaryDepartments) - needed to offer the branch picker below.
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => { /* non-critical - falls back to no branch picker */ });

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
        setEnrolledCount(s.studentCount ?? 0);
        setOwnerDept(s.department ?? "");
        setBranch(s.secondaryDepartments?.[0] ?? "");
        setForm({
          courseId: s.courseId ?? "",
          name: s.name,
          year: String(s.year),
          batch: s.batch,
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

  function handleFacultySelect(userUid: string) {
    if (!userUid) {
      setF({ facultyInchargeUid: "", facultyInchargeName: "" });
      return;
    }
    const f = facultyList.find((x) => x.userUid === userUid);
    if (!f) {
      toast({ variant: "destructive", title: "This faculty member has no login account yet — set one up first (Faculty → Set Login)." });
      return;
    }
    setF({ facultyInchargeUid: userUid, facultyInchargeName: f.name });
  }

  const formCourse = useMemo(() => courses.find((c) => c.id === form.courseId) ?? null, [courses, form.courseId]);
  const formYearOptions = useMemo(
    () => (formCourse ? Array.from({ length: formCourse.durationYears }, (_, i) => i + 1) : []),
    [formCourse]
  );

  // Collapse the several Course docs that represent one catalog programme into
  // a single dropdown choice - `courses` legitimately holds one row per related
  // department, so without this the Course dropdown lists "Bachelor of
  // Technology" once per department instead of once.
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const selectedCourseGroupKey = useMemo(
    () => courseGroups.find((g) => g.courseIds.includes(form.courseId))?.key ?? "",
    [courseGroups, form.courseId]
  );
  function selectCourseGroup(groupKey: string) {
    const group = courseGroups.find((g) => g.key === groupKey);
    if (!group) { setF({ courseId: "", year: "" }); setSubjects([]); return; }
    // Prefer the course doc owned by this section's own department, so the
    // stored courseId doesn't drift to a feeder department's row.
    const ownerDeptId = departments.find((d) => d.name === ownerDept)?.id;
    const own = group.courseIds.find((id) => courses.find((c) => c.id === id)?.departmentId === ownerDeptId);
    setF({ courseId: own ?? group.courseIds[0], year: "" });
    setSubjects([]);
  }

  // Branch mode: this section's owning department cross-lists to one or more
  // branches (a shared-first-year department). Offer them so the section's
  // target branch can be changed. Unchanged for standalone departments.
  const branchOptions = useMemo(() => {
    const dept = departments.find((d) => d.name === ownerDept);
    if (!dept) return [];
    if (dept.secondaryDepartments?.length) return dept.secondaryDepartments;
    // A sub-department inherits its parent's configured branches.
    if (dept.parentDepartmentId) {
      return departments.find((d) => d.id === dept.parentDepartmentId)?.secondaryDepartments ?? [];
    }
    return [];
  }, [departments, ownerDept]);
  const isBranchMode = branchOptions.length > 0;

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
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
          // Only sent for a shared-first-year department; re-points the section
          // to a branch (its students' promotion target).
          ...(isBranchMode && branch ? { secondaryDepartment: branch } : {}),
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
              <Select value={selectedCourseGroupKey} onValueChange={selectCourseGroup}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courseGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isBranchMode && (
              <div className="space-y-2">
                <Label>Branch (feeds into) *</Label>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                  <SelectContent>
                    {branchOptions.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Students in this section are promoted into this branch next year.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Section Name *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setF({ name: e.target.value.toUpperCase() })}
                  placeholder="A, B, C…"
                  maxLength={10}
                  className="uppercase"
                />
                <p className="text-xs text-muted-foreground">{isBranchMode ? "e.g. CSE-A" : "e.g. A, B, C or CS-A"}</p>
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
              <Label>Enrolled Students</Label>
              <p className="text-sm rounded-md border px-3 py-2 text-muted-foreground">
                <strong className="text-foreground">{enrolledCount}</strong> student{enrolledCount !== 1 ? "s" : ""} currently enrolled
              </p>
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
                  <SelectItem value="none">- Not assigned -</SelectItem>
                  {facultyList.map((f) => (
                    <SelectItem key={f.id} value={f.userUid || f.id} disabled={!f.userUid}>
                      {f.name}{f.accessLevel === "secondary" ? ` (${f.department})` : ""}{!f.userUid ? " (no login yet)" : ""}
                    </SelectItem>
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
                          <SelectItem value="none">- Unassigned -</SelectItem>
                          {facultyList.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}{f.accessLevel === "secondary" ? ` (${f.department})` : ""}
                            </SelectItem>
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
