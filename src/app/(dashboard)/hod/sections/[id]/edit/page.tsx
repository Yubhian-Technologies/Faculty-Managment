"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { resolveListBack } from "@/lib/listReturn";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { Course, Department, Section } from "@/types";

type SectionRow = Section & { id: string };
// `id` is the facultyMembers doc id. `userUid` is the faculty member's actual
// Firebase Auth uid (set once HOD creates their login via "Set Login") — used
// only for Section.facultyInchargeUid, which sections queries match directly
// against session.uid.
type FacultyOption = { id: string; name: string; designation: string; department?: string; accessLevel?: "primary" | "secondary"; userUid?: string };

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
  classroomNumber: string;
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

const EMPTY_FORM: SectionForm = {
  courseId: "", name: "", year: "", batch: "", regulation: "", classroomNumber: "", facultyInchargeUid: "", facultyInchargeName: "",
};

type ClassDetails = Pick<SectionForm, "facultyInchargeUid" | "facultyInchargeName" | "classroomNumber">;
const EMPTY_CLASS_DETAILS: ClassDetails = { facultyInchargeUid: "", facultyInchargeName: "", classroomNumber: "" };

// A value shown as plain text, in the same box shape as the inputs around it.
function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return <p className="flex min-h-11 items-center rounded-md border bg-muted/30 px-3 py-2 text-sm">{children}</p>;
}

export default function EditSectionPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const sectionId = params.id;
  // The Sections list as this page was reached from (filters, page).
  const listHref = resolveListBack(useSearchParams(), "/hod/sections");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const myDepartments = useAuthStore((st) => st.user?.departments);
  const myDepartment = useAuthStore((st) => st.user?.department);
  const allMyDepartments = useMemo(
    () => Array.from(new Set(myDepartments && myDepartments.length > 0 ? myDepartments : myDepartment ? [myDepartment] : [])),
    [myDepartments, myDepartment],
  );
  const [pickedFacultyDept, setPickedFacultyDept] = useState("");
  const [form, setForm] = useState<SectionForm>(EMPTY_FORM);
  const [sectionName, setSectionName] = useState("");
  // null = not touched: the box then reflects whether the stored name already
  // is the bare department code (a single-section department).
  const [singleChoice, setSingleChoice] = useState<boolean | null>(null);
  const [sectionCourseName, setSectionCourseName] = useState("");
  const [enrolledCount, setEnrolledCount] = useState(0);
  // Owning department name + the section's current target branch (if any), so
  // a shared-first-year section (e.g. Basic Science → CSE) can be re-pointed.
  const [ownerDept, setOwnerDept] = useState("");
  const [branch, setBranch] = useState("");
  const facultyDept = pickedFacultyDept && allMyDepartments.includes(pickedFacultyDept)
    ? pickedFacultyDept
    : allMyDepartments.includes(ownerDept) ? ownerDept : allMyDepartments[0] ?? "";

  // Class incharge and room are shown as plain text until "Edit" is pressed; "Cancel"
  // puts back what the section had when the page loaded.
  const [editingClassDetails, setEditingClassDetails] = useState(false);
  const [savedClassDetails, setSavedClassDetails] = useState<ClassDetails>(EMPTY_CLASS_DETAILS);

  // Faculty come from the department picked above the Faculty Incharge list - an HOD of
  // several departments (e.g. IT and CSBS) chooses which department's faculty to pick from.
  useEffect(() => {
    fetch(`/api/college/faculty?availableOnly=true${facultyDept ? `&department=${encodeURIComponent(facultyDept)}` : ""}`)
      .then((r) => r.json())
      .then((d: { faculty?: (FacultyOption & { legalName?: string })[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({
          id: f.id, name: facultyDisplayName(f), designation: f.designation, department: f.department, accessLevel: f.accessLevel, userUid: f.userUid,
        })));
      })
      .catch(() => { /* non-critical */ });
  }, [facultyDept]);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => { /* non-critical */ });

    fetch("/api/college/sections")
      .then((r) => r.json() as Promise<{ sections: SectionRow[] }>)
      .then((d) => {
        const s = (d.sections ?? []).find((x) => x.id === sectionId);
        if (!s) {
          toast({ variant: "destructive", title: "Section not found" });
          router.push(listHref);
          return;
        }
        setSectionName(s.name);
        setSectionCourseName(s.courseName ?? "");
        setEnrolledCount(s.studentCount ?? 0);
        setOwnerDept(s.department ?? "");
        setBranch(s.secondaryDepartments?.[0] ?? "");
        const loaded: SectionForm = {
          courseId: s.courseId ?? "",
          name: s.name,
          year: String(s.year),
          batch: s.batch,
          regulation: s.regulation ?? "",
          classroomNumber: s.classroomNumber ?? "",
          facultyInchargeUid: s.facultyInchargeUid ?? "",
          facultyInchargeName: s.facultyInchargeName ?? "",
        };
        setForm(loaded);
        setSavedClassDetails({
          facultyInchargeUid: loaded.facultyInchargeUid,
          facultyInchargeName: loaded.facultyInchargeName,
          classroomNumber: loaded.classroomNumber,
        });
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load section" }))
      .finally(() => setLoading(false));
  }, [sectionId, router, listHref]);

  useEffect(() => {
    if (!ownerDept) return;
    const deptId = departments.find((d) => d.name === ownerDept)?.id;
    const qs = deptId ? `?departmentId=${encodeURIComponent(deptId)}` : "";
    fetch(`/api/college/courses${qs}`)
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));
  }, [ownerDept, departments]);

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
      toast({ variant: "destructive", title: "This faculty member has no login account yet — set one up first (Faculty → Set Login)." });
      return;
    }
    setF({ facultyInchargeUid: userUid, facultyInchargeName: f.name });
  }

  function cancelClassDetailsEdit() {
    setF(savedClassDetails);
    setEditingClassDetails(false);
  }

  const formCourse = useMemo(() => courses.find((c) => c.id === form.courseId) ?? null, [courses, form.courseId]);
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const courseName = useMemo(
    () => courseGroups.find((g) => g.courseIds.includes(form.courseId))?.name || formCourse?.name || sectionCourseName,
    [courseGroups, form.courseId, formCourse, sectionCourseName]
  );

  const branchOptions = useMemo(() => {
    const dept = departments.find((d) => d.name === ownerDept);
    if (!dept) return [];
    if (dept.secondaryDepartments?.length) return dept.secondaryDepartments;
    if (dept.parentDepartmentId) {
      return departments.find((d) => d.id === dept.parentDepartmentId)?.secondaryDepartments ?? [];
    }
    return [];
  }, [departments, ownerDept]);
  const isBranchMode = branchOptions.length > 0;

  // A department with one section needs no letter: "CSE-A" becomes "CSE". The
  // name is only text on the section - the save below moves its students to the
  // new name exactly as any rename does, so nothing else changes.
  const ownerCode = departments.find((d) => d.name === ownerDept)?.code?.trim().toUpperCase() ?? "";
  const isSingle = singleChoice ?? (!!ownerCode && sectionName.toUpperCase() === ownerCode);
  function toggleSingle(checked: boolean) {
    setSingleChoice(checked);
    if (checked) {
      // Drop a trailing "-A"; a bare letter ("A") becomes the department code.
      const stripped = sectionName.replace(/-[A-Z0-9]{1,2}$/i, "");
      setF({ name: (stripped !== sectionName ? stripped : ownerCode || sectionName).toUpperCase() });
    } else {
      setF({ name: sectionName });
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Section name is required" }); return; }

    setSaving(true);
    try {
      const res = await fetch(`/api/college/sections/${sectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          classroomNumber: form.classroomNumber.trim() || null,
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
          ...(isBranchMode && branch ? { secondaryDepartment: branch } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }

      toast({ variant: "success", title: "Section updated" });
      router.push(listHref);
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-6xl">
        <PageHeader title="Edit Section" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        title={`Edit Section ${sectionName}`}
        description="Update this section's details"
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
          {/* Left Column: Section Details */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Section Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Course</Label>
                    <ReadOnlyValue>{courseName || "—"}</ReadOnlyValue>
                  </div>
                  <div className="space-y-2">
                    <Label>Year</Label>
                    <ReadOnlyValue>{form.year ? ordinalYear(Number(form.year)) : "—"}</ReadOnlyValue>
                    <p className="text-xs text-muted-foreground">
                      Fixed once created - moving a cohort to the next year is a promotion, not an edit here.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Batch</Label>
                    <ReadOnlyValue>{form.batch || "—"}</ReadOnlyValue>
                    <p className="text-xs text-muted-foreground">Admission year to passout year.</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Regulation</Label>
                    <ReadOnlyValue>{form.regulation || "None assigned"}</ReadOnlyValue>
                    <p className="text-xs text-muted-foreground">The curriculum this batch follows.</p>
                  </div>
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
                      maxLength={30}
                      className="uppercase"
                      disabled={isSingle}
                    />
                    <label className="flex items-center gap-2 pt-1 text-sm">
                      <Checkbox checked={isSingle} onCheckedChange={(c) => toggleSingle(c === true)} />
                      Only one section (no letter like A, B)
                    </label>
                    <p className="text-xs text-muted-foreground">
                      {isSingle ? "Saving renames the section and keeps all its students and data." : isBranchMode ? "e.g. CSE-A" : "e.g. A, B, C or CS-A"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Enrolled Students</Label>
                    <ReadOnlyValue>
                      <span><strong>{enrolledCount}</strong> student{enrolledCount !== 1 ? "s" : ""} currently enrolled</span>
                    </ReadOnlyValue>
                  </div>
                </div>

                <div className="space-y-3 border-t pt-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">Class Details</p>
                    {editingClassDetails ? (
                      <Button type="button" variant="ghost" size="sm" onClick={cancelClassDetailsEdit}>Cancel</Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditingClassDetails(true)}>Edit</Button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Faculty Incharge</Label>
                      {editingClassDetails ? (
                        <>
                          {allMyDepartments.length > 1 && (
                            <Select value={facultyDept} onValueChange={setPickedFacultyDept}>
                              <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                              <SelectContent>
                                {allMyDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
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
                            <p className="text-xs text-muted-foreground">No active faculty found in {facultyDept || "your department"}.</p>
                          )}
                        </>
                      ) : (
                        <ReadOnlyValue>{form.facultyInchargeName || "Not assigned"}</ReadOnlyValue>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Classroom Number</Label>
                      {editingClassDetails ? (
                        <Input
                          value={form.classroomNumber}
                          maxLength={40}
                          placeholder="e.g. B-204"
                          onChange={(e) => setF({ classroomNumber: e.target.value })}
                        />
                      ) : (
                        <ReadOnlyValue>{form.classroomNumber || "Not set"}</ReadOnlyValue>
                      )}
                    </div>
                  </div>
                  {editingClassDetails && (
                    <p className="text-xs text-muted-foreground">Changes apply when you press Save Changes.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

        </div>

        <div className="flex flex-col-reverse gap-3 border-t pt-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" loading={saving}>Save Changes</Button>
        </div>
      </form>
    </div>
  );
}
