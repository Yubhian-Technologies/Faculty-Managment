"use client";

import { useEffect, useMemo, useState } from "react";
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
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import type { Course, Department, Section } from "@/types";

type SectionRow = Section & { id: string };
// `id` is the facultyMembers doc id — used only as the React/Select key.
// `userUid` is the faculty member's actual Firebase Auth uid (set once their
// login is created via "Set Login") — Section.facultyInchargeUid must store
// this, since sections queries match it directly against session.uid.
type FacultyOption = { id: string; name: string; designation: string; userUid?: string };

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

type ClassLeaderUser = { uid: string; name: string; email: string };
type NewClassLeaderForm = { email: string; password: string };
const EMPTY_NEW_CLASS_LEADER: NewClassLeaderForm = { email: "", password: "" };

export default function EditSectionOfficePage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sectionId = params.id;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [form, setForm] = useState<SectionForm>(EMPTY_FORM);
  const [section, setSection] = useState<SectionRow | null>(null);

  const [classLeaderUser, setClassLeaderUser] = useState<ClassLeaderUser | null>(null);
  const [classLeaderLoading, setClassLeaderLoading] = useState(false);
  const [newClassLeader, setNewClassLeader] = useState<NewClassLeaderForm>(EMPTY_NEW_CLASS_LEADER);
  const [creatingClassLeader, setCreatingClassLeader] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [removeClassLeaderOpen, setRemoveClassLeaderOpen] = useState(false);
  const [removingClassLeader, setRemovingClassLeader] = useState(false);

  useEffect(() => {
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));

    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});

    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections: SectionRow[] }>)
      .then((d) => {
        const s = (d.sections ?? []).find((x) => x.id === sectionId);
        if (!s) {
          toast({ variant: "destructive", title: "Section not found" });
          router.push("/college-office/sections");
          return;
        }
        setSection(s);
        setForm({
          courseId: s.courseId ?? "",
          name: s.name,
          year: String(s.year),
          batch: s.batch,
          facultyInchargeUid: s.facultyInchargeUid ?? "",
          facultyInchargeName: s.facultyInchargeName ?? "",
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load section" }))
      .finally(() => setLoading(false));
  }, [sectionId, router]);

  useEffect(() => {
    if (!section?.department) { setFacultyList([]); return; }
    fetch(`/api/college/faculty?status=ACTIVE&department=${encodeURIComponent(section.department)}`)
      .then((r) => r.json())
      .then((d: { faculty?: { id: string; name: string; designation: string; userUid?: string }[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({ id: f.id, name: f.name, designation: f.designation, userUid: f.userUid })));
      })
      .catch(() => { /* non-critical */ });
  }, [section?.department]);

  useEffect(() => {
    if (!section?.classLeaderUid) { setClassLeaderUser(null); return; }
    setClassLeaderLoading(true);
    fetch(`/api/college/users/${section.classLeaderUid}`)
      .then((r) => r.json() as Promise<{ user?: { uid: string; name: string; email: string } }>)
      .then((d) => setClassLeaderUser(d.user ? { uid: d.user.uid, name: d.user.name, email: d.user.email } : null))
      .catch(() => setClassLeaderUser(null))
      .finally(() => setClassLeaderLoading(false));
  }, [section?.classLeaderUid]);

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
      setSection((s) => (s ? { ...s, classLeaderUid: json.uid } : s));
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
      setSection((s) => (s ? { ...s, classLeaderUid: undefined, classLeaderName: undefined } : s));
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

  function handleFacultySelect(userUid: string) {
    if (!userUid) {
      setF({ facultyInchargeUid: "", facultyInchargeName: "" });
      return;
    }
    const f = facultyList.find((x) => x.userUid === userUid);
    if (!f) {
      toast({ variant: "destructive", title: "This faculty member has no login account yet — set one up first." });
      return;
    }
    setF({ facultyInchargeUid: userUid, facultyInchargeName: f.name });
  }

  // A sub-department never has courses of its own - it borrows its parent's -
  // so the course dropdown must include both, same as the Add Section form.
  const coursesInDepartment = useMemo(() => {
    if (!section?.department) return [];
    const dept = departments.find((d) => d.name === section.department);
    const departmentIds = new Set([dept?.id, dept?.parentDepartmentId].filter(Boolean));
    return courses.filter((c) => departmentIds.has(c.departmentId));
  }, [courses, departments, section]);

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
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }
      toast({ variant: "success", title: "Section updated" });
      router.push(`/college-office/sections/${sectionId}`);
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !section) {
    return (
      <div className="max-w-xl">
        <PageHeader title="Edit Section" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title={`Edit ${sectionDisplayLabel(section, departments)}`}
        description={`${section.department || "(no department)"}${section.secondaryDepartments?.length ? ` → ${section.secondaryDepartments.join(", ")}` : ""}`}
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Section Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Course *</Label>
              <Select value={form.courseId} onValueChange={(v) => setF({ courseId: v, year: "" })}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {coursesInDepartment.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
                <strong className="text-foreground">{section.studentCount ?? 0}</strong> student{(section.studentCount ?? 0) !== 1 ? "s" : ""} currently enrolled
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
                      {f.name}{!f.userUid ? " (no login yet)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {facultyList.length === 0 && (
                <p className="text-xs text-muted-foreground">No active faculty found in this department yet.</p>
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
                No Class Leader login yet for this section - create one below. Just an email and password -
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
