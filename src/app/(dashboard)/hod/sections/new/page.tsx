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
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { findBranchManager } from "@/lib/departments/managedBranches";
import { buildCourseGroups, managerEffectiveYears } from "@/lib/departments/hodScope";
import { resolveDepartmentCourseScope, regulationsForYear } from "@/lib/college/academicStructure";
import { currentAcademicStartYear, admissionStartYearForCourseYear, deriveBatch, parseAcademicYearStart } from "@/lib/college/academicSession";
import type { Course, CourseCatalogItem, Department } from "@/types";

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
  year: string;
  batch: string;
  regulation: string;
  facultyInchargeUid: string;
  facultyInchargeName: string;
};

export default function NewSectionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCourseId = searchParams.get("courseId") ?? "";
  const myDepartments = useMyDepartments();

  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [facultyList, setFacultyList] = useState<FacultyOption[]>([]);
  const [form, setForm] = useState<SectionForm>({
    courseId: prefilledCourseId,
    year: "",
    batch: "",
    regulation: "",
    facultyInchargeUid: "",
    facultyInchargeName: "",
  });
  // This course's own assigned regulations (Course Catalog > Regulations),
  // narrowed to whichever are actually offered for the picked year - same
  // set the Dean's Add Subject page offers. Empty until a year is picked.
  const [catalogItems, setCatalogItems] = useState<CourseCatalogItem[]>([]);
  const [saving, setSaving] = useState(false);
  // Which of this HOD's own departments the section is being created under -
  // only shown/choosable when they head more than one (see useMyDepartments).
  // `pickedTopDepartment` holds only an explicit user choice; `topDepartment`
  // (derived, not stored) falls back to the first owned department so a
  // single-department HOD's flow is unchanged and nothing needs syncing via
  // an effect when the department list itself loads/changes.
  const [pickedTopDepartment, setPickedTopDepartment] = useState("");
  const topDepartment = pickedTopDepartment && myDepartments.includes(pickedTopDepartment)
    ? pickedTopDepartment
    : myDepartments[0] ?? "";
  // Empty unless a parent HOD explicitly targets one of their sub-departments.
  const [departmentName, setDepartmentName] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  // The container the choice was routed through (see DepartmentScopeSelect) -
  // the sub-department when one was picked, else the HOD's own department.
  // Drives the section-name prefix.
  const [viaDepartmentId, setViaDepartmentId] = useState("");
  // Shared-first-year flow: when the owning department has Secondary
  // Departments configured (e.g. Basic Science → CSE/ECE/IT), each section
  // feeds exactly one of those branches. `branch` is that target department's
  // name; `letter` is the section letter (A, B) so one branch can have several
  // sections. The stored section name is derived as `${branchCode}-${letter}`.
  const [branch, setBranch] = useState("");
  // Once `branch` (a top-level department, e.g. "Electronics and
  // Communication Engineering") is picked, its own sub-departments (e.g.
  // "ECE-VLSI") become an optional further narrowing - for students admitted
  // straight into that sub-department rather than the plain branch. Reset
  // whenever `branch` itself changes (see the Select below), since a
  // different branch has a different set of sub-departments.
  const [branchSubDept, setBranchSubDept] = useState("");
  const [letter, setLetter] = useState("");
  // The college's own configured current session, when a Principal has set
  // one via Settings > Academic Year (see AcademicYearSettingsCard.tsx) -
  // used to center the Batch picker's default on the right intake year for
  // whatever Year is picked. Falls back to the plain date-based session
  // (currentAcademicStartYear) when nothing's configured yet, same fallback
  // resolveCurrentAcademicYear itself uses.
  const [currentSessionStart, setCurrentSessionStart] = useState<number | null>(null);

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

    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items: CourseCatalogItem[] }>)
      .then((d) => setCatalogItems(d.items ?? []))
      .catch(() => { /* non-critical - regulation picker just stays empty */ });

    fetch("/api/college/academic-sessions")
      .then((r) => r.json() as Promise<{ academicSessions?: { label: string; isCurrent: boolean }[] }>)
      .then((d) => {
        const current = (d.academicSessions ?? []).find((s) => s.isCurrent);
        setCurrentSessionStart(current ? parseAcademicYearStart(current.label) ?? null : null);
      })
      .catch(() => { /* non-critical - Batch picker falls back to the date-based session */ });
  }, []);

  const topDepartmentId = useMemo(
    () => departments.find((d) => d.name === topDepartment)?.id ?? "",
    [departments, topDepartment]
  );

  // Refetched whenever the resolved owning department changes - a real branch
  // reached through a sub-department's managed grouping (e.g. IT under
  // BS-Maths) owns its OWN course doc, separate from the common department's,
  // so the college-wide "own scope" fetch this used to run once on mount would
  // never surface it. Empty departmentId (nothing picked yet, or a plain HOD
  // with no scope override) falls back to the server's own-department default.
  useEffect(() => {
    // An HOD with more than one department must always scope the fetch to
    // the chosen top-level department (topDepartmentId) - otherwise the
    // server's own-scope default unions courses across ALL of them, and the
    // Course dropdown would offer courses outside whichever one is selected.
    // A single-department HOD keeps the previous unscoped request, whose
    // server-side default also unions in that one department's own managed
    // branches - an explicit departmentId here would skip that extra union.
    const effectiveId = departmentId || (myDepartments.length > 1 ? topDepartmentId : "");
    const qs = effectiveId ? `?departmentId=${encodeURIComponent(effectiveId)}` : "";
    fetch(`/api/college/courses${qs}`)
      .then((r) => r.json() as Promise<{ courses: Course[] }>)
      .then((d) => setCourses((d.courses ?? []).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load courses" }));
  }, [departmentId, topDepartmentId, myDepartments]);

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

  // This course's own assigned regulations, narrowed to whichever are
  // actually offered for the picked year (regulationYears) - same set the
  // Dean's Add Subject page offers, so a section can only ever be tagged
  // with a regulation its own course/year combination could actually use.
  const regulationOptions = useMemo(() => {
    if (!formCourse?.catalogId || !form.year) return [];
    const catalogItem = catalogItems.find((c) => c.id === formCourse.catalogId);
    return regulationsForYear(catalogItem, Number(form.year));
  }, [formCourse, catalogItems, form.year]);

  function selectYear(year: string) {
    const sessionStart = currentSessionStart ?? currentAcademicStartYear();
    const admissionYear = admissionStartYearForCourseYear(sessionStart, Number(year));
    const batch = formCourse ? deriveBatch(admissionYear, formCourse.durationYears) : "";
    setF({ year, regulation: "", batch });
  }

  // Candidate intake years to offer in the Batch picker, centered on the
  // admission year this Course+Year combination actually implies for the
  // college's current session - a couple of intakes either side, so an HOD
  // can still deliberately pick an off-cycle admission year (e.g. correcting
  // a transition-year section - see Section.regulation's own doc-comment on
  // why that's a legitimate case), without ever typing an end year that
  // contradicts the course's real duration.
  const batchOptions = useMemo(() => {
    if (!formCourse || !form.year) return [];
    const sessionStart = currentSessionStart ?? currentAcademicStartYear();
    const center = admissionStartYearForCourseYear(sessionStart, Number(form.year));
    return [center + 1, center, center - 1, center - 2, center - 3].map((y) => deriveBatch(y, formCourse.durationYears));
  }, [formCourse, form.year, currentSessionStart]);

  // The department this section is being created under: the sub-department a
  // parent HOD explicitly targeted, otherwise the chosen top-level department
  // (topDepartment - their only department, unless they head several). Its
  // `assignedYears` ("Years Taught") is what the Year dropdown must honour.
  const activeDeptName = departmentName || topDepartment || "";
  const activeDept = useMemo(
    () => departments.find((d) => d.name === activeDeptName) ?? null,
    [departments, activeDeptName]
  );

  // Collapse the several Course docs that represent one catalog programme into
  // a single dropdown choice - `courses` legitimately holds one row per related
  // department (see buildCourseGroups' own comment), so without this the Course
  // dropdown lists "Bachelor of Technology" once per department instead of once.
  const courseGroups = useMemo(() => buildCourseGroups(courses), [courses]);
  const selectedCourseGroupKey = useMemo(
    () => courseGroups.find((g) => g.courseIds.includes(form.courseId))?.key ?? "",
    [courseGroups, form.courseId]
  );
  function selectCourseGroup(groupKey: string) {
    const group = courseGroups.find((g) => g.key === groupKey);
    if (!group) { setF({ courseId: "", year: "", regulation: "", batch: "" }); return; }
    // Prefer the course doc owned by the department this section is actually
    // being created under, so the stored courseId lines up with it rather than
    // a feeder's - same preference the Sections list uses when jumping here.
    const own = group.courseIds.find((id) => courses.find((c) => c.id === id)?.departmentId === (departmentId || activeDept?.id));
    // Batch depends on the course's own durationYears, so it's cleared here
    // (a different course may run for a different number of years) and
    // re-derived once selectYear runs for the newly picked course.
    setF({ courseId: own ?? group.courseIds[0], year: "", regulation: "", batch: "" });
  }

  // Managed-branch mode: activeDept is a real branch (e.g. IT) reached through
  // some sub-department's `managedDepartments` grouping (BS-Maths managing IT +
  // CSBS) rather than a plain pick of the HOD's own department. Takes priority
  // over the legacy secondaryDepartments branch mode below - a real branch
  // reached this way already IS the final department, so there's nothing left
  // to pick except the section letter.
  //
  // Gated on `departmentName` (an explicit DepartmentScopeSelect pick) rather
  // than a blanket "is this department managed by anyone, anywhere" check on
  // activeDept alone - CSE's own dedicated HOD lands here with departmentName
  // still "" (their own department used directly, no cascade shown at all),
  // and must see CSE's own assignedYears even if some sub-department
  // elsewhere ALSO manages CSE for a shared year. Only a caller who actually
  // picked their way through the cascade (departmentName set) is in
  // managed-branch mode.
  const branchManager = useMemo(
    () => (departmentName && activeDept ? findBranchManager(departments, activeDept.name, formCourse?.catalogId) : null),
    [departmentName, activeDept, departments, formCourse]
  );

  // Which container the cascade actually routed through, as reported by
  // DepartmentScopeSelect. It takes priority over the search above, because
  // searching can't distinguish the two routes to the same branch: CIVIL is
  // grouped under BS-ENGLISH *and* reachable straight from Basic Science, so
  // "who manages CIVIL" always answers BS-ENGLISH and named every such section
  // BSE-CIVIL-B even when it was created from Basic Science directly.
  const viaDept = useMemo(
    () => (viaDepartmentId ? departments.find((d) => d.id === viaDepartmentId) ?? null : null),
    [departments, viaDepartmentId]
  );
  const managingDept = useMemo(() => {
    if (!activeDept) return null;
    // Routed through itself - the department IS the target, not a container
    // feeding one, so there's no branch relationship and no prefix to add.
    if (viaDept) return viaDept.id === activeDept.id ? null : viaDept;
    return branchManager?.department ?? null;
  }, [activeDept, viaDept, branchManager]);
  const isManagedBranchMode = managingDept !== null;
  // The managing sub-department (or, if it has none of its own, its parent
  // common department) is where "Years Taught" for this shared year actually
  // lives - a real branch's own assignedYears (e.g. CIVIL's [2,3,4]) never
  // includes the shared first year on its own.
  // Computed from the manager actually in force rather than branchManager's own
  // years, since viaDept may have overridden which department that is. Resolved
  // per the selected course's catalogId (managerEffectiveYears) rather than the
  // manager's flat assignedYears alone, so a manager offering a per-course
  // override (Department.courseScopes) is honoured the same as everywhere else.
  const managingYears = useMemo(
    () => (managingDept ? managerEffectiveYears(managingDept, departments, formCourse?.catalogId) : []),
    [managingDept, departments, formCourse]
  );
  // Derived section name: the managing sub-department's own code (e.g.
  // "BS-ENGLISH" - already self-describing, since sub-department codes are set
  // to read as their parent's shared-year structure) + the real branch's code
  // + the letter, e.g. "BS-ENGLISH-CIVIL-C". When the common department manages
  // the branch directly with no intermediate sub-department, managingDept IS
  // that common department, so its own code is used the same way.
  const managedBranchName = `${managingDept?.code?.trim() ? `${managingDept.code.trim()}-` : ""}${activeDept?.code?.trim() || activeDeptName}-${letter.trim().toUpperCase()}`;

  // Offer only the years this department is assigned to teach for the selected
  // course, intersected with the course's own span. A department set to
  // [1,2,3] never shows Year 4 even for a 4-year course, and a department
  // running an independent course under its own per-course override (e.g.
  // AIDS's Master of Technology spanning years 1-2 while its Bachelor of
  // Technology spans 2-4 - Department.courseScopes, resolved by
  // resolveDepartmentCourseScope) sees that override rather than its flat
  // years. In managed-branch mode, ONLY the common structure's years
  // (managingYears - typically just the shared first year) are offered, never
  // the branch's own later years: this Sub-Department cascade is how the
  // shared first year is routed, but Year 2 onward belongs to that branch's own
  // dedicated HOD (set by the Principal), created through the plain flow
  // instead. When no years are assigned yet (or departments haven't loaded),
  // fall back to the full course span so creation isn't blocked - the server
  // still rejects an unassigned year on submit.
  const formYearOptions = useMemo(() => {
    if (!formCourse) return [];
    const courseYears = Array.from({ length: formCourse.durationYears }, (_, i) => i + 1);
    // managerEffectiveYears (not resolveDepartmentCourseScope directly) even
    // in the plain, non-managed-branch case: a sub-department targeted
    // directly usually carries no assignedYears/courseScopes of its own
    // (Principal-only override, stripped from anything HOD-created) and must
    // inherit its parent's, or every year in the course's span was silently
    // offered here regardless of what the parent was actually assigned.
    const assigned = isManagedBranchMode
      ? managingYears
      : (activeDept ? managerEffectiveYears(activeDept, departments, formCourse.catalogId) : []);
    return assigned.length > 0 ? courseYears.filter((y) => assigned.includes(y)) : courseYears;
  }, [formCourse, isManagedBranchMode, managingYears, activeDept, departments]);

  // Legacy branch mode: the owning department cross-lists to one or more
  // branches (Department.secondaryDepartments, resolved per the selected
  // course's own courseScopes override when it has one - e.g. a department's
  // independent M.Tech cross-lists no one even though its shared-first-year
  // B.Tech does). When it does, the section feeds a branch instead of using a
  // free-typed name. Only relevant when managed-branch mode above doesn't
  // already apply.
  const branchOptions = useMemo(() => {
    if (isManagedBranchMode || !activeDept) return [];
    const ownBranches = resolveDepartmentCourseScope(activeDept, formCourse?.catalogId).secondaryDepartments;
    if (ownBranches.length) return ownBranches;
    // A sub-department inherits its parent's configured branches, so a sub-HOD
    // can create the shared first-year branch sections too.
    if (activeDept.parentDepartmentId) {
      const parent = departments.find((d) => d.id === activeDept.parentDepartmentId);
      return parent ? resolveDepartmentCourseScope(parent, formCourse?.catalogId).secondaryDepartments : [];
    }
    return [];
  }, [isManagedBranchMode, activeDept, departments, formCourse]);
  const isBranchMode = branchOptions.length > 0;
  const branchCodeOf = (name: string) =>
    departments.find((d) => d.name === name)?.code?.trim() || name;
  // The picked branch's own sub-departments (e.g. ECE -> ECE-VLSI) - offered
  // as an optional further narrowing once a branch with any is picked, for
  // students admitted straight into that sub-department. Configuring the
  // parent as a Core Department (Edit Department page) is enough; a
  // sub-department never needs to be separately, individually configured
  // there for this to work (see isConfiguredSecondaryDepartmentOrChild's own
  // doc-comment - the section/student write paths accept it either way).
  const branchDept = useMemo(() => departments.find((d) => d.name === branch) ?? null, [departments, branch]);
  const branchSubDeptOptions = useMemo(
    () => (branchDept ? departments.filter((d) => d.parentDepartmentId === branchDept.id) : []),
    [departments, branchDept]
  );
  // What the section actually feeds and gets submitted as - the narrowed
  // sub-department when one was picked, otherwise the plain branch.
  const effectiveBranch = branchSubDept || branch;
  // Derived section name in legacy branch mode: primary department code + branch
  // code + letter, e.g. Basic Science → CSE → "BS-CSE-A" (or, narrowed to a
  // sub-department, Chemistry → ECE-VLSI → "CHEMISTRY-ECEVLSI-A"). The primary
  // prefix makes the section self-describing (which shared department owns it
  // and which branch it feeds) everywhere it appears - lists, rosters,
  // promotion dropdowns.
  const ownerCode = activeDept?.code?.trim() || "";
  const derivedName = branch && letter
    ? `${ownerCode ? `${ownerCode}-` : ""}${branchCodeOf(effectiveBranch)}-${letter.trim().toUpperCase()}`
    : "";
  // Plain mode: this department's own code + letter, e.g. CSE's own dedicated
  // HOD creating a 2nd-year section gets "CSE-A" - no shared-structure prefix,
  // since this department owns every year it's creating a section for directly.
  const plainDerivedName = `${activeDept?.code?.trim() || activeDeptName}-${letter.trim().toUpperCase()}`;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.courseId) { toast({ variant: "destructive", title: "Course is required" }); return; }
    if (isBranchMode && !isManagedBranchMode && !branch) {
      toast({ variant: "destructive", title: "Branch is required" }); return;
    }
    if (!letter.trim()) { toast({ variant: "destructive", title: "Section letter is required (e.g. A, B)" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Year is required" }); return; }
    if (!form.batch.trim()) { toast({ variant: "destructive", title: "Batch is required (e.g. 2023-2027)" }); return; }

    // Managed-branch mode: the section belongs directly to the resolved real
    // branch (activeDept, e.g. IT) - name is just "{code}-{letter}", no owner
    // prefix, since the department IS the branch, not a container feeding it.
    // Legacy branch mode: name carries the owning (common) department's prefix
    // too, and the chosen branch is sent as the section's secondary department
    // so its students inherit it and auto-promote into that branch later.
    // Otherwise (plain): this department's own code + letter.
    const sectionName = isManagedBranchMode ? managedBranchName : isBranchMode ? derivedName : plainDerivedName;

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
          regulation: form.regulation || undefined,
          facultyInchargeUid: form.facultyInchargeUid || null,
          facultyInchargeName: form.facultyInchargeName,
          ...(isBranchMode && !isManagedBranchMode ? { secondaryDepartment: effectiveBranch } : {}),
          // Omitted only when this HOD has exactly one department and picked
          // no sub-department - the API then falls back to that one
          // department, as before. Otherwise always sent: a parent HOD's
          // sub-department pick (or, in managed-branch mode, the resolved
          // real branch) takes priority; failing that, the chosen top-level
          // department disambiguates for an HOD who heads more than one.
          ...(departmentId ? { departmentId } : topDepartmentId ? { departmentId: topDepartmentId } : {}),
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
            {/* Only shown for an HOD who heads more than one department. */}
            {myDepartments.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="top-department">Department *</Label>
                <Select
                  value={topDepartment}
                  onValueChange={(v) => {
                    setPickedTopDepartment(v);
                    // A different top-level department has a different sub-
                    // department cascade, assigned years, and course list -
                    // clear everything downstream.
                    setDepartmentName(""); setDepartmentId(""); setViaDepartmentId("");
                    setF({ year: "", courseId: "" }); setBranch(""); setLetter("");
                  }}
                >
                  <SelectTrigger id="top-department"><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {myDepartments.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">You manage more than one department - choose which this section belongs to.</p>
              </div>
            )}

            {/* Only rendered for a parent HOD who actually has sub-departments. */}
            <DepartmentScopeSelect
              value={departmentName}
              ownDepartmentName={topDepartment}
              onChange={(name, id, via) => {
                setDepartmentName(name); setDepartmentId(id); setViaDepartmentId(via);
                // The owning department changed - its assigned years, its
                // configured branches, and (for a real branch) its own course
                // list all differ, so clear everything downstream.
                setF({ year: "", courseId: "" }); setBranch(""); setLetter("");
              }}
              hint="Create this section in your own department or one of its sub-departments."
            />

            <div className="space-y-2">
              <Label>Course *</Label>
              <Select value={selectedCourseGroupKey} onValueChange={selectCourseGroup}>
                <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                <SelectContent>
                  {courseGroups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {isManagedBranchMode ? (
              <>
                {/* The cascade above already resolved the real branch (e.g.
                    CIVIL) - all that's left is the letter. The name carries the
                    code of whichever container it was routed through:
                    "BS-CIVIL-B" straight from Basic Science, "BSE-CIVIL-B" via
                    BS-ENGLISH. */}
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
                    <Select value={form.year} onValueChange={selectYear} disabled={!formCourse}>
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
                    feeds one of the configured branches, so pick the branch
                    first, then (optionally) narrow to one of its own
                    sub-departments, before the letter/year pair. */}
                <div className="space-y-2">
                  <Label>Core Department *</Label>
                  <Select
                    value={branch}
                    onValueChange={(v) => { setBranch(v); setBranchSubDept(""); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Select core department" /></SelectTrigger>
                    <SelectContent>
                      {branchOptions.map((b) => (
                        <SelectItem key={b} value={b}>{b} ({branchCodeOf(b)})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Students in this section are promoted into this core department next year.
                  </p>
                </div>
                {/* Only shown once a branch with its own sub-departments is
                    picked (e.g. ECE -> ECE-VLSI) - optional, defaults to the
                    plain branch. Configuring the branch itself as a Core
                    Department is enough for its sub-departments to show up
                    here; nothing extra needs to be configured per
                    sub-department. */}
                {branchSubDeptOptions.length > 0 && (
                  <div className="space-y-2">
                    <Label>Sub-Department (optional)</Label>
                    <Select
                      value={branchSubDept || "none"}
                      onValueChange={(v) => setBranchSubDept(v === "none" ? "" : v)}
                    >
                      <SelectTrigger><SelectValue placeholder="Select sub-department" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{branch} itself</SelectItem>
                        {branchSubDeptOptions.map((d) => (
                          <SelectItem key={d.id} value={d.name}>{d.name} ({d.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Students admitted straight into a specific sub-department under {branch} - leave as
                      &quot;{branch} itself&quot; for a plain {branchCodeOf(branch)} section.
                    </p>
                  </div>
                )}
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
                      Section name will be {derivedName ? <strong className="text-foreground">{derivedName}</strong> : "e.g. BS-CSE-A"}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Year *</Label>
                    <Select value={form.year} onValueChange={selectYear} disabled={!formCourse}>
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
            ) : (
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
                      ? <strong className="text-foreground">{plainDerivedName}</strong>
                      : `e.g. ${activeDept?.code || "CSE"}-A`}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Year *</Label>
                  <Select value={form.year} onValueChange={selectYear} disabled={!formCourse}>
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Batch *</Label>
                <Select value={form.batch} onValueChange={(v) => setF({ batch: v })} disabled={!form.year}>
                  <SelectTrigger><SelectValue placeholder={form.year ? "Select batch" : "Pick a year first"} /></SelectTrigger>
                  <SelectContent>
                    {batchOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Admission year to passout year, derived from this course&apos;s duration</p>
              </div>
              <div className="space-y-2">
                <Label>Regulation</Label>
                <Select
                  value={form.regulation}
                  onValueChange={(v) => setF({ regulation: v })}
                  disabled={!form.year || regulationOptions.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={form.year ? (regulationOptions.length ? "Select regulation" : "None assigned for this year") : "Pick a year first"} />
                  </SelectTrigger>
                  <SelectContent>
                    {regulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Which curriculum this batch follows for its whole run through this class.</p>
              </div>
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
