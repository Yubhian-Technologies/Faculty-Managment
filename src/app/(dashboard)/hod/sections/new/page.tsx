"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DepartmentScopeSelect } from "@/components/shared/DepartmentScopeSelect";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import type { Course, Department } from "@/types";

// `id` is the facultyMembers doc id — used only as the React/Select key.
// `userUid` is the faculty member's actual Firebase Auth uid (set once HOD
// creates their login via "Set Login") — Section.facultyInchargeUid must
// store this, since sections queries match it directly against session.uid.
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

export default function NewSectionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCourseId = searchParams.get("courseId") ?? "";
  const user = useAuthStore((s) => s.user);

  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [form, setForm] = useState<SectionForm>({
    courseId: prefilledCourseId,
    name: "",
    year: "",
    batch: "",
    facultyInchargeUid: "",
    facultyInchargeName: "",
  });
  const [saving, setSaving] = useState(false);
  // Empty unless a parent HOD explicitly targets one of their sub-departments.
  const [departmentName, setDepartmentName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  // Shared-first-year flow: when the owning department has Secondary
  // Departments configured (e.g. Basic Science → CSE/ECE/IT), each section
  // feeds exactly one of those branches. `branch` is that target department's
  // name; `letter` is the section letter (A, B) so one branch can have several
  // sections. The stored section name is derived as `${branchCode}-${letter}`.
  const [branch, setBranch] = useState("");
  const [letter, setLetter] = useState("");

  useEffect(() => {
    fetch("/api/college/faculty?status=ACTIVE")
      .then((r) => r.json())
      .then((d: { faculty?: { id: string; name: string; designation: string; userUid?: string }[] }) => {
        setFacultyList((d.faculty ?? []).map((f) => ({ id: f.id, name: f.name, designation: f.designation, userUid: f.userUid })));
      })
      .catch(() => { /* non-critical */ });

    // Departments carry `assignedYears` (the "Years Taught" the Principal set) -
    // needed to scope the Year dropdown to what this department actually teaches.
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => { /* non-critical - falls back to the full course span */ });
  }, []);

  // Refetched whenever the resolved owning department changes - a real branch
  // reached through a sub-department's managed grouping (e.g. IT under
  // BS-Maths) owns its OWN course doc, separate from the common department's,
  // so the college-wide "own scope" fetch this used to run once on mount would
  // never surface it. Empty departmentId (nothing picked yet, or a plain HOD
  // with no scope override) falls back to the server's own-department default.
  useEffect(() => {
    const qs = departmentId ? `?departmentId=${encodeURIComponent(departmentId)}` : "";
    fetch(`/api/college/courses${qs}`)
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));
  }, [departmentId]);

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

  const formCourse = useMemo(() => courses.find((c) => c.id === form.courseId) ?? null, [courses, form.courseId]);

  // The department this section is being created under: the sub-department a
  // parent HOD explicitly targeted, otherwise their own department. Its
  // `assignedYears` ("Years Taught") is what the Year dropdown must honour.
  const activeDeptName = departmentName || user?.department || "";
  const activeDept = useMemo(
    () => departments.find((d) => d.name === activeDeptName) ?? null,
    [departments, activeDeptName]
  );

  // Managed-branch mode: activeDept is a real branch (e.g. IT) reached through
  // some sub-department's `managedDepartments` grouping (BS-Maths managing IT +
  // CSBS) rather than a plain pick of the HOD's own department. Takes priority
  // over the legacy secondaryDepartments branch mode below - a real branch
  // reached this way already IS the final department, so there's nothing left
  // to pick except the section letter.
  const managingDept = useMemo(
    () => (activeDept ? departments.find((d) => (d.managedDepartments ?? []).includes(activeDept.name)) ?? null : null),
    [departments, activeDept]
  );
  const isManagedBranchMode = managingDept !== null;
  // The managing sub-department (or, if it has none of its own, its parent
  // common department) is where "Years Taught" for this shared year actually
  // lives - a real branch's own assignedYears (e.g. CIVIL's [2,3,4]) never
  // includes the shared first year on its own.
  const managingYears = useMemo(() => {
    if (!managingDept) return [] as number[];
    if ((managingDept.assignedYears?.length ?? 0) > 0) return managingDept.assignedYears ?? [];
    if (managingDept.parentDepartmentId) {
      return departments.find((d) => d.id === managingDept.parentDepartmentId)?.assignedYears ?? [];
    }
    return [];
  }, [managingDept, departments]);
  // Derived section name: the managing sub-department's own code (e.g.
  // "BS-ENGLISH" - already self-describing, since sub-department codes are set
  // to read as their parent's shared-year structure) + the real branch's code
  // + the letter, e.g. "BS-ENGLISH-CIVIL-C". When the common department manages
  // the branch directly with no intermediate sub-department, managingDept IS
  // that common department, so its own code is used the same way.
  const managedBranchName = `${managingDept?.code?.trim() ? `${managingDept.code.trim()}-` : ""}${activeDept?.code?.trim() || activeDeptName}-${letter.trim().toUpperCase()}`;

  // Offer only the years this department is assigned to teach, intersected with
  // the course's own span. A department set to [1,2,3] never shows Year 4 even
  // for a 4-year course. In managed-branch mode, ONLY the common structure's
  // years (managingYears - typically just the shared first year) are offered,
  // never the branch's own later years: this Sub-Department cascade is how the
  // shared first year is routed, but Year 2 onward belongs to that branch's own
  // dedicated HOD (set by the Principal), created through the plain flow
  // instead. When no years are assigned yet (or departments haven't loaded),
  // fall back to the full course span so creation isn't blocked - the server
  // still rejects an unassigned year on submit.
  const formYearOptions = useMemo(() => {
    if (!formCourse) return [];
    const courseYears = Array.from({ length: formCourse.durationYears }, (_, i) => i + 1);
    const assigned = isManagedBranchMode ? managingYears : (activeDept?.assignedYears ?? []);
    return assigned.length > 0 ? courseYears.filter((y) => assigned.includes(y)) : courseYears;
  }, [formCourse, isManagedBranchMode, managingYears, activeDept]);

  // Legacy branch mode: the owning department cross-lists to one or more
  // branches (Department.secondaryDepartments). When it does, the section
  // feeds a branch instead of using a free-typed name. Only relevant when
  // managed-branch mode above doesn't already apply.
  const branchOptions = useMemo(() => {
    if (isManagedBranchMode || !activeDept) return [];
    if (activeDept.secondaryDepartments?.length) return activeDept.secondaryDepartments;
    // A sub-department inherits its parent's configured branches, so a sub-HOD
    // can create the shared first-year branch sections too.
    if (activeDept.parentDepartmentId) {
      return departments.find((d) => d.id === activeDept.parentDepartmentId)?.secondaryDepartments ?? [];
    }
    return [];
  }, [isManagedBranchMode, activeDept, departments]);
  const isBranchMode = branchOptions.length > 0;
  const branchCodeOf = (name: string) =>
    departments.find((d) => d.name === name)?.code?.trim() || name;
  // Derived section name in legacy branch mode: primary department code + branch
  // code + letter, e.g. Basic Science → CSE → "BS-CSE-A". The primary prefix
  // makes the section self-describing (which shared department owns it and
  // which branch it feeds) everywhere it appears - lists, rosters, promotion
  // dropdowns.
  const ownerCode = activeDept?.code?.trim() || "";
  const derivedName = branch && letter
    ? `${ownerCode ? `${ownerCode}-` : ""}${branchCodeOf(branch)}-${letter.trim().toUpperCase()}`
    : "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.courseId) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (isManagedBranchMode) {
      if (!letter.trim()) { toast({ variant: "destructive", title: "Section letter is required (e.g. A, B)" }); return; }
    } else if (isBranchMode) {
      if (!branch) { toast({ variant: "destructive", title: "Branch is required" }); return; }
      if (!letter.trim()) { toast({ variant: "destructive", title: "Section letter is required (e.g. A, B)" }); return; }
    } else if (!form.name.trim()) {
      toast({ variant: "destructive", title: "Section name is required" }); return;
    }
    if (!form.year) { toast({ variant: "destructive", title: "Year is required" }); return; }
    if (!form.batch.trim()) { toast({ variant: "destructive", title: "Batch is required (e.g. 2023-2027)" }); return; }

    // Managed-branch mode: the section belongs directly to the resolved real
    // branch (activeDept, e.g. IT) - name is just "{code}-{letter}", no owner
    // prefix, since the department IS the branch, not a container feeding it.
    // Legacy branch mode: name carries the owning (common) department's prefix
    // too, and the chosen branch is sent as the section's secondary department
    // so its students inherit it and auto-promote into that branch later.
    // Otherwise: whatever the HOD typed.
    const sectionName = isManagedBranchMode ? managedBranchName : isBranchMode ? derivedName : form.name;

    setSaving(true);
    try {
      const res = await fetch("/api/college/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: form.courseId,
          name: sectionName,
          year: Number(form.year),
          batch: form.batch,
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
          ...(isBranchMode && !isManagedBranchMode ? { secondaryDepartment: branch } : {}),
          // Omitted unless a parent HOD picked a sub-department (or, in
          // managed-branch mode, the resolved real branch); the API then falls
          // back to their own department, as before.
          ...(departmentId ? { departmentId } : {}),
        }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        toast({ variant: "destructive", title: json.error ?? "Failed to save" });
        return;
      }
      toast({ variant: "success", title: "Section created" });
      router.push("/hod/sections");
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
        description="Create a new class section for your department"
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Section Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Only rendered for a parent HOD who actually has sub-departments. */}
            <DepartmentScopeSelect
              value={departmentName}
              onChange={(name, id) => {
                setDepartmentName(name); setDepartmentId(id);
                // The owning department changed - its assigned years, its
                // configured branches, and (for a real branch) its own course
                // list all differ, so clear everything downstream.
                setF({ year: "", courseId: "" }); setBranch(""); setLetter("");
              }}
              hint="Create this section in your own department or one of its sub-departments."
            />

            <div className="space-y-2">
              <Label>Course *</Label>
              <Select value={form.courseId} onValueChange={(v) => setF({ courseId: v, year: "" })}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isManagedBranchMode ? (
              <>
                {/* The Sub-Department/Department cascade above already resolved
                    the real branch (e.g. CIVIL) this section belongs to - all
                    that's left is the section letter. The name carries the
                    root common department's code too (e.g. "BS-CIVIL-A"), since
                    that's the shared-first-year structure this section is
                    actually routed through. */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Section Letter *</Label>
                    <Input
                      value={letter}
                      onChange={(e) => setLetter(e.target.value.toUpperCase())}
                      placeholder="A, B…"
                      maxLength={2}
                      className="uppercase"
                    />
                    <p className="text-xs text-muted-foreground">
                      Section name will be{" "}
                      {letter.trim()
                        ? <strong className="text-foreground">{managedBranchName}</strong>
                        : `e.g. ${managingDept?.code?.trim() ? `${managingDept.code.trim()}-` : ""}${activeDept?.code || "CIVIL"}-A`}
                    </p>
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
              </>
            ) : isBranchMode ? (
              <>
                {/* Shared-first-year department (e.g. Basic Science): the section
                    feeds one of the configured branches, so pick the branch +
                    a section letter instead of typing a free-form name. */}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Branch (feeds into) *</Label>
                    <Select value={branch} onValueChange={setBranch}>
                      <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {branchOptions.map((b) => (
                          <SelectItem key={b} value={b}>{b} ({branchCodeOf(b)})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Students in this section are promoted into this branch next year.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Section Letter *</Label>
                    <Input
                      value={letter}
                      onChange={(e) => setLetter(e.target.value.toUpperCase())}
                      placeholder="A, B…"
                      maxLength={2}
                      className="uppercase"
                    />
                    <p className="text-xs text-muted-foreground">
                      Section name will be {derivedName ? <strong className="text-foreground">{derivedName}</strong> : "e.g. BS-CSE-A"}
                    </p>
                  </div>
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
              </>
            ) : (
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
            )}

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
                <p className="text-xs text-muted-foreground">No active faculty found in your department.</p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" loading={saving}>Create Section</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
