"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { regulationsForYear } from "@/lib/college/academicStructure";
import type { Course, CourseCatalogItem, Department, Section, Subject, TeachingAssignment } from "@/types";

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
  regulation: string;
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

const EMPTY_FORM: SectionForm = {
  courseId: "", name: "", year: "", batch: "", regulation: "", facultyInchargeUid: "", facultyInchargeName: "",
};

type ClassLeaderUser = { uid: string; name: string; email: string };
type NewClassLeaderForm = { email: string; password: string };
const EMPTY_NEW_CLASS_LEADER: NewClassLeaderForm = { email: "", password: "" };

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
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);

  // Class Leader (CR) login - bound to this section via Section.classLeaderUid.
  const [classLeaderUid, setClassLeaderUid] = useState<string | undefined>(undefined);
  const [classLeaderUser, setClassLeaderUser] = useState<ClassLeaderUser | null>(null);
  const [classLeaderLoading, setClassLeaderLoading] = useState(false);
  const [newClassLeader, setNewClassLeader] = useState<NewClassLeaderForm>(EMPTY_NEW_CLASS_LEADER);
  const [creatingClassLeader, setCreatingClassLeader] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [removeClassLeaderOpen, setRemoveClassLeaderOpen] = useState(false);
  const [removingClassLeader, setRemovingClassLeader] = useState(false);

  // Subjects & faculty (per-subject teaching assignments for this section)
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [originalFaculty, setOriginalFaculty] = useState<Record<string, string>>({}); // subjectId -> facultyId
  const [stagedFaculty, setStagedFaculty] = useState<Record<string, string>>({});
  const assignmentIdBySubject = useRef<Record<string, string>>({});

  // Scoped to this section's own regulation (when set) so "Subjects & Faculty"
  // below only offers the curriculum this section's own batch actually
  // follows, instead of every regulation's subjects for the year mixed
  // together - the /api/college/subjects GET filter is lenient (a subject
  // with no regulation of its own still matches), so this stays safe for
  // subjects created before regulation existed.
  const loadSubjects = useCallback((courseId: string, year: string, regulation: string) => {
    if (!courseId || !year) { setSubjects([]); return; }
    setSubjectsLoading(true);
    fetch(`/api/college/subjects?courseId=${courseId}&year=${year}${regulation ? `&regulation=${encodeURIComponent(regulation)}` : ""}`)
      .then((r) => r.json() as Promise<{ subjects?: SubjectRow[] }>)
      .then((d) => setSubjects(d.subjects ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load subjects" }))
      .finally(() => setSubjectsLoading(false));
  }, []);

  useEffect(() => {
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

    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => { /* non-critical - regulation picker just stays empty */ });

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
        setClassLeaderUid(s.classLeaderUid);
        setForm({
          courseId: s.courseId ?? "",
          name: s.name,
          year: String(s.year),
          batch: s.batch,
          regulation: s.regulation ?? "",
          facultyInchargeUid: s.facultyInchargeUid ?? "",
          facultyInchargeName: s.facultyInchargeName ?? "",
        });
        loadSubjects(s.courseId ?? "", String(s.year), s.regulation ?? "");
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

  // Courses are scoped to this section's own (owning) department, same as the
  // Add Section form's `?departmentId=` fetch - without this, the Course
  // dropdown listed every course in the whole college (e.g. an unrelated
  // department's Master of Technology showing up while editing a Civil
  // Engineering section), not just what this department actually offers.
  // Depends on `departments` too since the department name -> id lookup needs
  // it, and both `ownerDept` and `departments` resolve asynchronously from
  // separate fetches above.
  useEffect(() => {
    if (!ownerDept) return;
    const deptId = departments.find((d) => d.name === ownerDept)?.id;
    const qs = deptId ? `?departmentId=${encodeURIComponent(deptId)}` : "";
    fetch(`/api/college/courses${qs}`)
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));
  }, [ownerDept, departments]);

  const loadClassLeaderUser = useCallback(async (uid: string) => {
    setClassLeaderLoading(true);
    try {
      const r = await fetch(`/api/college/users/${uid}`);
      const d = await r.json() as { user?: { uid: string; name: string; email: string } };
      setClassLeaderUser(d.user ? { uid: d.user.uid, name: d.user.name, email: d.user.email } : null);
    } catch {
      setClassLeaderUser(null);
    } finally {
      setClassLeaderLoading(false);
    }
  }, []);

  // classLeaderUser is already null both times classLeaderUid can be falsy
  // here - initial state, and right after handleRemoveClassLeader (which
  // nulls it itself) - so there's nothing to sync in that case, only a fetch
  // to kick off when it's set.
  useEffect(() => {
    if (!classLeaderUid) return;
    void (async () => { await loadClassLeaderUser(classLeaderUid); })();
  }, [classLeaderUid, loadClassLeaderUser]);

  async function handleCreateClassLeader(e: React.FormEvent) {
    e.preventDefault();
    if (!newClassLeader.email.trim() || !newClassLeader.password) {
      toast({ variant: "destructive", title: "Email and password are both required" });
      return;
    }
    if (newClassLeader.password.length < 6) {
      toast({ variant: "destructive", title: "Password must be at least 6 characters" });
      return;
    }
    setCreatingClassLeader(true);
    try {
      const res = await fetch("/api/college/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: newClassLeader.email.trim(),
          password: newClassLeader.password,
          role: "CLASS_LEADER",
          sectionId,
        }),
      });
      const json = await res.json() as { uid?: string; error?: string };
      if (!res.ok || !json.uid) {
        toast({ variant: "destructive", title: json.error ?? "Failed to create Class Leader login" });
        return;
      }
      toast({ variant: "success", title: "Class Leader account created" });
      setNewClassLeader(EMPTY_NEW_CLASS_LEADER);
      setClassLeaderUid(json.uid);
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setCreatingClassLeader(false);
    }
  }

  async function handleResetPassword() {
    if (!classLeaderUser) return;
    if (resetPasswordValue.length < 6) {
      toast({ variant: "destructive", title: "Password must be at least 6 characters" });
      return;
    }
    setResettingPassword(true);
    try {
      const res = await fetch(`/api/college/users/${classLeaderUser.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword: resetPasswordValue }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to reset password" });
        return;
      }
      toast({ variant: "success", title: "Password reset" });
      setResetPasswordOpen(false);
      setResetPasswordValue("");
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setResettingPassword(false);
    }
  }

  async function handleRemoveClassLeader() {
    if (!classLeaderUser) return;
    setRemovingClassLeader(true);
    try {
      const res = await fetch(`/api/college/users/${classLeaderUser.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to remove Class Leader login" });
        return;
      }
      toast({ variant: "success", title: "Class Leader login removed" });
      setClassLeaderUser(null);
      setClassLeaderUid(undefined);
      setRemoveClassLeaderOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setRemovingClassLeader(false);
    }
  }

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

  // This course's own assigned regulations, narrowed to whichever are
  // actually offered for this section's (fixed) year - same set the Dean's
  // Add Subject page and Add Section form offer.
  const regulationOptions = useMemo(() => {
    if (!formCourse?.catalogId || !form.year) return [];
    const catalogItem = catalogItems.find((c) => c.id === formCourse.catalogId);
    return regulationsForYear(catalogItem, Number(form.year));
  }, [formCourse, catalogItems, form.year]);

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
    // Year is fixed (see the read-only Year field below) - a course change
    // never resets it, only revalidates subjects against the (unchanged) year;
    // the server rejects a course whose own span or teaching-years no longer
    // fit that fixed year.
    if (!group) { setF({ courseId: "", regulation: "" }); setSubjects([]); return; }
    // Prefer the course doc owned by this section's own department, so the
    // stored courseId doesn't drift to a feeder department's row.
    const ownerDeptId = departments.find((d) => d.name === ownerDept)?.id;
    const own = group.courseIds.find((id) => courses.find((c) => c.id === id)?.departmentId === ownerDeptId);
    const newCourseId = own ?? group.courseIds[0];
    // A different course may not offer the previously-picked regulation for
    // this (fixed) year - clear it and let the HOD re-pick.
    setF({ courseId: newCourseId, regulation: "" });
    loadSubjects(newCourseId, form.year, "");
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
          // Year is deliberately not sent - it's fixed once the section is
          // created (see the read-only Year field below); the server also
          // rejects an HOD attempting to change it directly regardless.
          batch: form.batch,
          regulation: form.regulation || null,
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
                <Label>Core Department *</Label>
                <Select value={branch} onValueChange={setBranch}>
                  <SelectTrigger><SelectValue placeholder="Select core department" /></SelectTrigger>
                  <SelectContent>
                    {branchOptions.map((b) => (
                      <SelectItem key={b} value={b}>{b}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Students in this section are promoted into this core department next year.
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
                <Label>Year</Label>
                <Input value={form.year ? ordinalYear(Number(form.year)) : ""} disabled readOnly />
                <p className="text-xs text-muted-foreground">
                  Fixed once created - moving a cohort to the next year is a promotion, not an edit here.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                <Label>Regulation</Label>
                <Select
                  value={form.regulation}
                  onValueChange={(v) => { setF({ regulation: v }); loadSubjects(form.courseId, form.year, v); }}
                  disabled={!form.year || regulationOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={regulationOptions.length ? "Select regulation" : "None assigned for this year"} />
                  </SelectTrigger>
                  <SelectContent>
                    {regulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Which curriculum the batch currently in this class follows. Update this when a new batch moves in.
                </p>
              </div>
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
                        <p className="text-xs text-muted-foreground">
                          {subj.code} · {subj.hoursPerWeek} hrs/week{subj.regulation ? ` · ${subj.regulation}` : ""}
                        </p>
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

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Class Leader Login</CardTitle>
        </CardHeader>
        <CardContent>
          {classLeaderLoading ? (
            <div className="h-16 rounded-md border bg-muted/30 animate-pulse" />
          ) : classLeaderUser ? (
            <div className="space-y-4">
              <div className="rounded-md border px-3 py-2">
                <p className="text-sm font-medium">{classLeaderUser.name}</p>
                <p className="text-xs text-muted-foreground">{classLeaderUser.email}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setResetPasswordOpen(true)}>
                  Reset Password
                </Button>
                <Button type="button" variant="destructive" size="sm" onClick={() => setRemoveClassLeaderOpen(true)}>
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void handleCreateClassLeader(e)} className="space-y-4">
              <p className="text-xs text-muted-foreground">
                No Class Leader (CR) login yet for this section - create one below. Just an email and password -
                the login isn&apos;t tied to a specific student&apos;s name, since who holds the role can change
                per your college&apos;s rules.
              </p>
              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  autoComplete="off"
                  value={newClassLeader.email}
                  onChange={(e) => setNewClassLeader((c) => ({ ...c, email: e.target.value }))}
                  placeholder="classleader@college.edu"
                />
              </div>
              <div className="space-y-2">
                <Label>Temporary Password</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={newClassLeader.password}
                  onChange={(e) => setNewClassLeader((c) => ({ ...c, password: e.target.value }))}
                  placeholder="Min 6 characters"
                />
              </div>
              <Button type="submit" size="sm" loading={creatingClassLeader}>Create Class Leader</Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Dialog open={resetPasswordOpen} onOpenChange={setResetPasswordOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Class Leader Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New Password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={resetPasswordValue}
              onChange={(e) => setResetPasswordValue(e.target.value)}
              placeholder="Min 6 characters"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResetPasswordOpen(false)}>Cancel</Button>
            <Button type="button" loading={resettingPassword} onClick={() => void handleResetPassword()}>Reset Password</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeClassLeaderOpen}
        onOpenChange={setRemoveClassLeaderOpen}
        title="Remove Class Leader login?"
        description={`This deactivates ${classLeaderUser?.name ?? "this"}'s login and frees up this section for a new Class Leader.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleRemoveClassLeader()}
        loading={removingClassLeader}
      />
    </div>
  );
}
