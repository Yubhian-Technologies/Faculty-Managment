"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { ArrowLeft, Edit2, Trash2, BookOpen, Plus } from "lucide-react";
import type { Department, Subject, SubjectCategory } from "@/types";
import { SUBJECT_TYPE_LABELS } from "@/types";
import { CategoryField } from "@/components/academics/CategoryField";
import { offeredYears } from "@/lib/college/departmentYears";
import { courseYearNumbers, semesterLabel } from "@/lib/college/courseYears";
import { useCourseSemesterPlan } from "@/hooks/useCourseSemesterPlan";

// Academics > Subjects. View and manage subjects assigned to departments
// by year and semester in a horizontal table with CRUD & bulk delete capabilities.

type CourseOption = { id: string; name: string; catalogId?: string; departmentId?: string; isActive?: boolean; durationYears?: number };
// The whole Department doc, not a three-field shape: the Year dropdown is
// built from the department's own Years Taught (assignedYears / per-course
// courseScopes / the parent it inherits from), which that shape dropped.
type DepartmentOption = Department;
type AssignmentWithMaster = { assignment: any; master: Subject };
type EditForm = {
  assignmentId?: string;
  subjectId: string;
  // Subject-level: saved on the master subject, so they change it in every department.
  name: string;
  code: string;
  shortCode: string;
  altShortCode: string;
  serialNumber: string;
  category: string;
  customCategory: string;
  type: string;
  totalHoursPerSemester: string;
  // This department's own hours/credits for the semester.
  lectureHours: string;
  tutorialHours: string;
  practicalHours: string;
  credits: string;
  excludeFromTeachingLoad: boolean;
};

type AddForm = {
  regulation: string; serialNumber: string; category: string; customCategory: string;
  name: string; code: string; shortCode: string; type: string;
  lectureHours: string; tutorialHours: string; practicalHours: string; credits: string;
  excludeFromTeachingLoad: boolean;
  /** Other departments that also get a semester row for the SAME subject (no copies). */
  alsoDeptIds: string[];
};
const EMPTY_ADD: AddForm = {
  regulation: "", serialNumber: "", category: "", customCategory: "", name: "", code: "", shortCode: "",
  type: "THEORY", lectureHours: "0", tutorialHours: "0", practicalHours: "0", credits: "0",
  excludeFromTeachingLoad: false, alsoDeptIds: [],
};

const SELECT_CLASS ="h-9 w-full rounded-md border bg-background px-2 text-sm";

export default function SubjectsPage() {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [deptId, setDeptId] = useState("");
  const [subDeptId, setSubDeptId] = useState("");
  // Nothing is pre-picked: the page opens asking for a course, a department,
  // a year and a semester rather than silently loading somebody else's.
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [assignments, setAssignments] = useState<AssignmentWithMaster[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [regulations, setRegulations] = useState<Record<string, string[]>>({});
  const [addForm, setAddForm] = useState<AddForm | null>(null);
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [deleting, setDeleting] = useState<any>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [c, d] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: CourseOption[] }>),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: DepartmentOption[] }>),
        ]);
        // Only the options. The first course and the first department used to be
        // picked here and loaded straight away, which answered a question nobody
        // had asked - and for a department that teaches neither the year nor the
        // semester it was loaded for.
        setCourses((c.courses ?? []).filter((x) => x.isActive !== false));
        setDepartments(d.departments ?? []);
      } catch {
        setLoadError("Couldn't load courses or departments.");
      }
    })();
  }, []);

  useEffect(() => {
    fetch("/api/college/course-catalog")
      .then((r) => r.json() as Promise<{ items?: { id: string; regulations?: string[] }[] }>)
      .then((d) => setRegulations(Object.fromEntries((d.items ?? []).map((c) => [c.id, c.regulations ?? []]))))
      .catch(() => { /* regulation list just stays empty */ });
  }, []);

  const courseGroups = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; ids: string[] }>();
    for (const c of courses) {
      const key = c.catalogId ?? `name:${c.name}`;
      const g = groups.get(key) ?? { key, name: c.name, ids: [] };
      g.ids.push(c.id);
      groups.set(key, g);
    }
    return Array.from(groups.values());
  }, [courses]);
  const topDepartments = useMemo(() => departments.filter((d) => !d.parentDepartmentId), [departments]);
  const subDepartments = useMemo(() => departments.filter((d) => d.parentDepartmentId === deptId), [departments, deptId]);
  const activeDeptId = subDeptId || deptId;

  // Years and semesters come from the configuration, never from a fixed 1-4 /
  // 1-8. A department teaches the years the Principal assigned it (Basic
  // Science only year 1), and a course's semesters and their numbering come
  // from its own Semester Timings - so the labels read 1-1, 1-2, 2-1 ... in
  // whatever shape that college set up, not a flat "Sem 1 ... Sem 8".
  const catalogId = courseKey.startsWith("name:") ? undefined : courseKey || undefined;
  const courseIdsOfGroup = useMemo(
    () => new Set(courseGroups.find((g) => g.key === courseKey)?.ids ?? []),
    [courseGroups, courseKey]
  );
  // The department's own Course doc for this programme decides the semester
  // shape; every department owns one, and they can differ.
  const planCourse = useMemo(
    () => courses.find((c) => courseIdsOfGroup.has(c.id) && c.departmentId === activeDeptId)
      ?? courses.find((c) => courseIdsOfGroup.has(c.id))
      ?? null,
    [courses, courseIdsOfGroup, activeDeptId]
  );
  const plan = useCourseSemesterPlan(planCourse);
  const activeDept = useMemo(() => departments.find((d) => d.id === activeDeptId), [departments, activeDeptId]);
  // Falls back to the course's own span, never an invented 1-4, for a
  // department whose Years Taught has not been set yet.
  const yearOptions = useMemo(
    () => offeredYears(activeDept, departments, catalogId, courseYearNumbers(planCourse?.durationYears)),
    [activeDept, departments, catalogId, planCourse]
  );
  // Derived rather than corrected in an effect, so what is shown and what Load
  // sends can never disagree. A pick that falls outside the options - after
  // changing department, say - clears rather than silently becoming another
  // year, so the choice goes back to whoever is looking at it.
  const yearValue = yearOptions.includes(Number(year)) ? year : "";
  // Strictly what this course has configured for this year - read off the
  // plan's own timings, never semestersInYear, whose two-per-year default is a
  // LABEL fallback for pages that must still show something, not configuration.
  // A course with no Semester Timings offers no semesters here, and says so.
  const semesterOptions = useMemo(
    () => (yearValue && plan.source === "timings"
      ? plan.semesters.filter((sem) => plan.yearOf(sem) === Number(yearValue))
      : []),
    [plan, yearValue]
  );
  const semestersNotConfigured = !!courseKey && !!activeDeptId && !!yearValue && semesterOptions.length === 0;
  const semesterValue = semesterOptions.includes(Number(semester)) ? semester : "";
  // Sibling sub-departments (or the children of a parent picked "itself") that can share one added subject.
  const siblingDepts = useMemo(() => {
    const active = departments.find((d) => d.id === activeDeptId);
    const parentId = active?.parentDepartmentId ?? activeDeptId;
    return departments.filter((d) => d.parentDepartmentId === parentId && d.id !== activeDeptId);
  }, [departments, activeDeptId]);

  async function fetchAssignments(
    cKey: string,
    aDeptId: string,
    sDeptId: string,
    yr: string,
    sem: string,
    courseList = courses
  ) {
    const groups = new Map<string, { key: string; name: string; ids: string[] }>();
    for (const c of courseList) {
      const key = c.catalogId ?? `name:${c.name}`;
      const g = groups.get(key) ?? { key, name: c.name, ids: [] };
      g.ids.push(c.id);
      groups.set(key, g);
    }
    const group = groups.get(cKey);
    const targetDeptId = sDeptId || aDeptId;
    if (!group || !targetDeptId) { setLoadError("Please select course and department."); return; }
    if (!yr || !sem) { setLoadError("Please select year and semester."); return; }

    setIsLoading(true);
    setLoadError("");
    setSelectedIds(new Set());
    try {
      const responses = await Promise.all(group.ids.map((id) => fetch(
        `/api/college/subject-semester-assignments?courseId=${encodeURIComponent(id)}&departmentId=${encodeURIComponent(targetDeptId)}&year=${yr}&semester=${sem}`
      )));
      const merged = new Map<string, any>();
      for (const res of responses) {
        const body = await res.json() as { assignments?: any[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Failed to load");
        for (const a of body.assignments ?? []) merged.set(a.id, a);
      }
      setAssignments(Array.from(merged.values())
        .sort((a, b) => String(a.subjectCode).localeCompare(String(b.subjectCode)))
        .map((a) => ({
          assignment: a,
          master: { id: a.subjectId, code: a.subjectCode, name: a.subjectName, shortCode: a.shortCode, category: a.category } as Subject,
        })));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load subjects.");
    } finally {
      setIsLoading(false);
      setHasLoaded(true);
    }
  }

  function handleLoad() {
    void fetchAssignments(courseKey, deptId, subDeptId, yearValue, semesterValue);
  }

  const allSelected = assignments.length > 0 && selectedIds.size === assignments.length;
  const someSelected = selectedIds.size > 0 && selectedIds.size < assignments.length;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(assignments.map((item) => item.assignment.id)));
    }
  }

  function toggleSelectOne(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  function openAdd() {
    setAddError("");
    setAddForm({ ...EMPTY_ADD, regulation: (regulations[courseKey] ?? [])[0] ?? "" });
  }

  async function handleAdd() {
    if (!addForm) return;
    setAddError("");
    const group = courseGroups.find((g) => g.key === courseKey);
    // A sub-department owns no Course doc: its subjects live on the parent's course.
    const owner = departments.find((d) => d.id === activeDeptId);
    const ownerIds = [activeDeptId, owner?.parentDepartmentId];
    const course = courses.find((c) => group?.ids.includes(c.id) && ownerIds.includes(c.departmentId));
    if (!course) { setAddError("No course found for this department."); return; }
    if (!addForm.name.trim() || !addForm.code.trim()) { setAddError("Name and code are required."); return; }
    if (addForm.serialNumber.trim() === "") { setAddError("S.No. is required."); return; }
    if (!addForm.category) { setAddError("Category is required."); return; }
    if (addForm.category === "OTHER" && !addForm.customCategory.trim()) { setAddError("Enter a name for the custom category."); return; }
    setIsAdding(true);
    try {
      const sres = await fetch("/api/college/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: course.id,
          regulation: addForm.regulation,
          serialNumber: Number(addForm.serialNumber),
          category: addForm.category,
          customCategory: addForm.customCategory.trim(),
          name: addForm.name.trim(),
          code: addForm.code.trim(),
          shortCode: addForm.shortCode.trim(),
          type: addForm.type,
          lectureHours: Number(addForm.lectureHours) || 0,
          tutorialHours: Number(addForm.tutorialHours) || 0,
          practicalHours: Number(addForm.practicalHours) || 0,
          credits: Number(addForm.credits) || 0,
          excludeFromTeachingLoad: addForm.excludeFromTeachingLoad,
        }),
      });
      const sbody = await sres.json() as { id?: string; subject?: { id: string }; error?: string; existingSubjectId?: string; existingSubjectName?: string };
      // Same code + name already exists for this course (e.g. added under another department):
      // reuse it and just list it under this department, instead of refusing.
      const subjectId = sbody.id ?? sbody.subject?.id ?? (sres.status === 409 ? sbody.existingSubjectId : undefined);
      if (!subjectId || (!sres.ok && sres.status !== 409)) { setAddError(sbody.error ?? "Failed to add the subject."); return; }

      const ares = await fetch("/api/college/subject-semester-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, departmentId: activeDeptId, courseId: course.id, year: Number(yearValue), semester: Number(semesterValue) }),
      });
      if (!ares.ok) {
        const abody = await ares.json() as { error?: string };
        setAddError(`Subject created, but not assigned to Year ${yearValue} Sem ${semesterLabel(plan, Number(semesterValue))}: ${abody.error ?? "failed"}. Use Course Structure to assign it.`);
        return;
      }
      // The same subject, listed under the other ticked departments too (one row each, no copies).
      const failedDepts: string[] = [];
      for (const extraId of addForm.alsoDeptIds) {
        const r = await fetch("/api/college/subject-semester-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subjectId, departmentId: extraId, courseId: course.id, year: Number(yearValue), semester: Number(semesterValue) }),
        });
        if (!r.ok) failedDepts.push(departments.find((d) => d.id === extraId)?.name ?? extraId);
      }
      if (failedDepts.length > 0) {
        setAddError(`Subject added, but not listed under: ${failedDepts.join(", ")}. Tick them and use Edit/Course Structure to assign it.`);
        handleLoad();
        return;
      }
      if (!sres.ok) toast({ title: `Used the existing subject "${sbody.existingSubjectName ?? addForm.code}" (same code)` });
      toast({ variant: "success", title: addForm.alsoDeptIds.length > 0 ? `Subject added to ${addForm.alsoDeptIds.length + 1} departments` : "Subject added" });
      setAddForm(null);
      handleLoad();
    } catch {
      setAddError("Network error.");
    } finally {
      setIsAdding(false);
    }
  }

  function openEdit(item: AssignmentWithMaster) {
    setEditError("");
    const a = item.assignment;
    setEditForm({
      assignmentId: a.id,
      subjectId: a.subjectId,
      name: a.subjectName ?? item.master.name ?? "",
      code: a.subjectCode ?? item.master.code ?? "",
      shortCode: a.shortCode ?? item.master.shortCode ?? "",
      altShortCode: a.altShortCode ?? item.master.altShortCode ?? "",
      serialNumber: a.serialNumber != null ? String(a.serialNumber) : "",
      category: a.category ?? item.master.category ?? "",
      customCategory: a.customCategory ?? "",
      type: a.type ?? "THEORY",
      totalHoursPerSemester: a.totalHoursPerSemester != null ? String(a.totalHoursPerSemester) : "",
      lectureHours: String(item.assignment.lectureHours ?? item.master.lectureHours ?? 0),
      tutorialHours: String(item.assignment.tutorialHours ?? item.master.tutorialHours ?? 0),
      practicalHours: String(item.assignment.practicalHours ?? item.master.practicalHours ?? 0),
      credits: String(item.assignment.credits ?? item.master.credits ?? 0),
      excludeFromTeachingLoad: Boolean(a.isNonTeachingLoad ?? item.master.isNonTeachingLoad),
    });
  }

  async function handleSave() {
    if (!editForm?.assignmentId) return;
    setIsSaving(true);
    setEditError("");
    if (!editForm.name.trim() || !editForm.code.trim()) { setIsSaving(false); setEditError("Name and code are required."); return; }
    if (editForm.category === "OTHER" && !editForm.customCategory.trim()) { setIsSaving(false); setEditError("Enter a name for the custom category."); return; }
    try {
      // 1) The subject itself (name, code, category, ...) - also re-labels the
      // teaching assignments and timetable slots that use it.
      const totalSem = editForm.totalHoursPerSemester.trim() === "" ? null : Number(editForm.totalHoursPerSemester);
      const master = {
        name: editForm.name.trim(),
        code: editForm.code.trim(),
        shortCode: editForm.shortCode.trim(),
        altShortCode: editForm.altShortCode.trim(),
        type: editForm.type,
        totalHoursPerSemester: totalSem,
        excludeFromTeachingLoad: editForm.excludeFromTeachingLoad,
        ...(editForm.serialNumber.trim() !== "" ? { serialNumber: Number(editForm.serialNumber) } : {}),
        ...(editForm.category ? { category: editForm.category, customCategory: editForm.customCategory.trim() } : {}),
      };
      const mres = await fetch(`/api/college/subjects/${encodeURIComponent(editForm.subjectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(master),
      });
      if (!mres.ok) { const json = await mres.json() as { error?: string }; setEditError(json.error ?? "Failed to save the subject."); return; }

      // 2) This department's hours/credits, plus the subject copies kept on every assignment row.
      const res = await fetch(`/api/college/subject-semester-assignments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editForm.assignmentId,
          lectureHours: Number(editForm.lectureHours) || 0,
          tutorialHours: Number(editForm.tutorialHours) || 0,
          practicalHours: Number(editForm.practicalHours) || 0,
          credits: Number(editForm.credits) || 0,
          snapshot: {
            subjectName: master.name,
            subjectCode: master.code,
            shortCode: master.shortCode,
            altShortCode: master.altShortCode,
            type: master.type,
            totalHoursPerSemester: master.totalHoursPerSemester,
            ...(master.serialNumber != null ? { serialNumber: master.serialNumber } : {}),
            ...(master.category ? { category: master.category, customCategory: master.customCategory || null } : {}),
          },
        }),
      });
      if (!res.ok) { const json = await res.json() as { error?: string }; setEditError(json.error ?? "Failed to save."); return; }
      toast({ variant: "success", title: "Subject updated" });
      setEditForm(null);
      await handleLoad();
    } catch {
      setEditError("Network error. Nothing was saved.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/college/subject-semester-assignments?subjectId=${encodeURIComponent(deleting.subjectId)}&departmentId=${encodeURIComponent(deleting.departmentId)}&semester=${deleting.semester}&hardDelete=true`,
        { method: "DELETE" }
      );
      if (!res.ok) { const json = await res.json() as { error?: string }; toast({ variant: "destructive", title: json.error ?? "Couldn't delete" }); return; }
      toast({ variant: "success", title: "Subject deleted everywhere" });
      await handleLoad();
    } catch {
      toast({ variant: "destructive", title: "Network error." });
    } finally {
      setIsDeleting(false);
      setDeleting(null);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return;
    setIsBulkDeleting(true);
    const selectedItems = assignments.filter((item) => selectedIds.has(item.assignment.id));
    
    const results = await Promise.allSettled(
      selectedItems.map(async (item) => {
        const del = item.assignment;
        const res = await fetch(
          `/api/college/subject-semester-assignments?subjectId=${encodeURIComponent(del.subjectId)}&departmentId=${encodeURIComponent(del.departmentId)}&semester=${del.semester}&hardDelete=true`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? "Failed to delete");
        }
      })
    );

    const successCount = results.filter((r) => r.status === "fulfilled").length;
    const failResults = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    const failCount = failResults.length;

    setIsBulkDeleting(false);
    setShowBulkConfirm(false);
    setSelectedIds(new Set());

    if (successCount > 0) {
      toast({
        variant: failCount > 0 ? "default" : "success",
        title: `Deleted ${successCount} subject(s) everywhere${failCount > 0 ? `, ${failCount} failed` : ""}`,
        description: failCount > 0 ? failResults[0]?.reason?.message : undefined,
      });
    } else if (failCount > 0) {
      toast({
        variant: "destructive",
        title: `Failed to delete subjects`,
        description: failResults[0]?.reason?.message || "Check permissions.",
      });
    }

    await handleLoad();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="View and manage subjects by department, year and semester"
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button onClick={openAdd} disabled={!courseKey || !deptId || !yearValue || !semesterValue}>
              <Plus className="h-4 w-4 mr-1" />Add Subject
            </Button>
            <Button variant="outline" asChild>
              <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back</Link>
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className={`grid gap-3 pt-6 ${subDepartments.length > 0 ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
          <div className="space-y-1.5">
            <Label htmlFor="course">Course</Label>
            <select id="course" className={SELECT_CLASS} value={courseKey} onChange={(e) => setCourseKey(e.target.value)}>
              <option value="">Select course</option>
              {courseGroups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dept">Department</Label>
            <select id="dept" className={SELECT_CLASS} value={deptId} onChange={(e) => { setDeptId(e.target.value); setSubDeptId(""); }}>
              <option value="">Select department</option>
              {topDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          {subDepartments.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="subdept">Sub-department</Label>
              <select id="subdept" className={SELECT_CLASS} value={subDeptId} onChange={(e) => setSubDeptId(e.target.value)}>
                <option value="">Department itself</option>
                {subDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="yr">Year</Label>
            <select id="yr" className={SELECT_CLASS} value={yearValue} onChange={(e) => setYear(e.target.value)}>
              <option value="">Select year</option>
              {yearOptions.map((y) => <option key={y} value={String(y)}>Year {y}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sem">Semester</Label>
            <select id="sem" className={SELECT_CLASS} value={semesterValue} onChange={(e) => setSemester(e.target.value)}>
              <option value="">Select semester</option>
              {/* The label is the course's own year-semester position - "1-1",
                  "1-2", "1-3" where a year has three - and nothing else. */}
              {semesterOptions.map((s) => <option key={s} value={String(s)}>{semesterLabel(plan, s)}</option>)}
            </select>
            {semestersNotConfigured && (
              <p className="text-xs text-muted-foreground">
                No semesters set for this year — ask the Office to add them under Semester Timings.
              </p>
            )}
          </div>
          <div className="flex items-end">
            <Button onClick={() => void handleLoad()} className="w-full" disabled={!courseKey || !deptId || !yearValue || !semesterValue}>
              Load
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error display */}
      {loadError && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">{loadError}</div>}

      {/* Bulk Action Toolbar */}
      {assignments.length > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 bg-card rounded-lg border">
          <div className="flex items-center gap-3 text-sm">
            <Checkbox
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={toggleSelectAll}
              aria-label="Select all subjects"
            />
            <span className="font-medium text-xs text-muted-foreground">
              {selectedIds.size > 0 ? `${selectedIds.size} of ${assignments.length} selected` : `${assignments.length} total subjects`}
            </span>
          </div>
          {selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkConfirm(true)}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Delete Selected ({selectedIds.size})
            </Button>
          )}
        </div>
      )}

      {/* Horizontal Table Layout */}
      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <BookOpen className="h-8 w-8 mx-auto mb-2 text-muted-foreground/60" />
            {hasLoaded ? "No subjects are added." : "Select filters and click Load to view subjects."}
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50 border-b text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                <th className="p-3 w-10 text-center">
                  <Checkbox
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="p-3 w-28">Code</th>
                <th className="p-3 min-w-[180px]">Subject Name</th>
                <th className="p-3 w-28">Category</th>
                <th className="p-3 w-16 text-center">L</th>
                <th className="p-3 w-16 text-center">T</th>
                <th className="p-3 w-16 text-center">P</th>
                <th className="p-3 w-24 text-center">Total Hrs</th>
                <th className="p-3 w-20 text-center">Credits</th>
                <th className="p-3 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {assignments.map((item) => {
                const isSelected = selectedIds.has(item.assignment.id);
                const notInLoad = Boolean(item.master.isNonTeachingLoad || (item.assignment as any).isNonTeachingLoad);
                const lec = item.assignment.lectureHours ?? item.master.lectureHours ?? 0;
                const tut = item.assignment.tutorialHours ?? item.master.tutorialHours ?? 0;
                const prac = item.assignment.practicalHours ?? item.master.practicalHours ?? 0;
                const totalHours = lec + tut + prac;
                const credits = item.assignment.credits ?? item.master.credits ?? 0;

                return (
                  <tr
                    key={item.assignment.id}
                    className={`transition-colors hover:bg-muted/40 ${isSelected ? "bg-primary/5" : ""}`}
                  >
                    <td className="p-3 text-center">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelectOne(item.assignment.id)}
                        aria-label={`Select ${item.master.name}`}
                      />
                    </td>
                    <td className="p-3 font-mono font-medium text-xs">
                      <span className="inline-block px-2 py-0.5 rounded bg-muted text-foreground font-semibold">
                        {item.master.code}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-foreground">{item.master.name}</p>
                        {notInLoad && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                            Not in teaching load
                          </span>
                        )}
                      </div>
                      {item.master.shortCode && (
                        <p className="text-xs text-muted-foreground font-mono">{item.master.shortCode}</p>
                      )}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {item.master.category || "—"}
                    </td>
                    <td className="p-3 text-center font-medium">{lec}</td>
                    <td className="p-3 text-center font-medium">{tut}</td>
                    <td className="p-3 text-center font-medium">{prac}</td>
                    <td className="p-3 text-center font-bold text-foreground">{totalHours}</td>
                    <td className="p-3 text-center font-semibold text-primary">{credits}</td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0"
                          onClick={() => openEdit(item)}
                          title="Edit Subject"
                        >
                          <Edit2 className="h-4 w-4 text-muted-foreground hover:text-foreground" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 w-8 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeleting(item.assignment)}
                          title="Remove Subject"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add Dialog */}
      <Dialog open={!!addForm} onOpenChange={(open) => !open && setAddForm(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Add Subject</DialogTitle></DialogHeader>
          {addForm && (
            <div className="grid gap-3">
              <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 p-2">
                Adds the subject to <strong>{departments.find((d) => d.id === activeDeptId)?.name}</strong>
                {subDeptId ? " (sub-department)" : ""}, Year {yearValue}, Sem {semesterLabel(plan, Number(semesterValue))}.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Regulation</Label>
                  <select className={SELECT_CLASS} value={addForm.regulation} onChange={(e) => setAddForm({ ...addForm, regulation: e.target.value })}>
                    {(regulations[courseKey] ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>S.No.</Label>
                  <Input type="number" min={0} value={addForm.serialNumber} onChange={(e) => setAddForm({ ...addForm, serialNumber: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Subject Name</Label>
                <Input value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <Input value={addForm.code} onChange={(e) => setAddForm({ ...addForm, code: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Short Code</Label>
                  <Input value={addForm.shortCode} onChange={(e) => setAddForm({ ...addForm, shortCode: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <select className={SELECT_CLASS} value={addForm.type} onChange={(e) => setAddForm({ ...addForm, type: e.target.value })}>
                  {Object.entries(SUBJECT_TYPE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <CategoryField
                  category={addForm.category as SubjectCategory | ""}
                  customCategory={addForm.customCategory}
                  onCategoryChange={(c) => setAddForm({ ...addForm, category: c })}
                  onCustomCategoryChange={(v) => setAddForm({ ...addForm, customCategory: v })}
                />
              </div>
              <div className="grid grid-cols-4 gap-3">
                {([["lectureHours", "L"], ["tutorialHours", "T"], ["practicalHours", "P"], ["credits", "Credits"]] as const).map(([k, label]) => (
                  <div key={k} className="space-y-1.5">
                    <Label>{label}</Label>
                    <Input type="number" min={0} step={k === "credits" ? "0.5" : "1"} value={addForm[k]} onChange={(e) => setAddForm({ ...addForm, [k]: e.target.value })} />
                  </div>
                ))}
              </div>
              {siblingDepts.length > 0 && (
                <div className="space-y-1.5 rounded-md border p-2.5">
                  <Label className="text-xs">Also list this same subject under</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {siblingDepts.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={addForm.alsoDeptIds.includes(d.id)}
                          onCheckedChange={(v) => setAddForm({
                            ...addForm,
                            alsoDeptIds: v === true ? [...addForm.alsoDeptIds, d.id] : addForm.alsoDeptIds.filter((x) => x !== d.id),
                          })}
                        />
                        {d.name}
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">One subject, shared - ticking never makes copies.</p>
                </div>
              )}
              <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                <Checkbox
                  checked={addForm.excludeFromTeachingLoad}
                  onCheckedChange={(v) => setAddForm({ ...addForm, excludeFromTeachingLoad: v === true })}
                  aria-label="Don't include in teaching load"
                />
                <span>
                  <span className="font-medium">Don&apos;t include in teaching load</span>
                  <span className="block text-xs text-muted-foreground">
                    e.g. Counselling. It is still assigned, timetabled and attended, but kept off the faculty&apos;s teaching load and resume, and they stay listed as free in those periods.
                  </span>
                </span>
              </label>
            </div>
          )}
          {addError && <p className="text-sm text-red-600">{addError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddForm(null)}>Cancel</Button>
            <Button onClick={() => void handleAdd()} loading={isAdding}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editForm} onOpenChange={(open) => !open && setEditForm(null)}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Edit Subject</DialogTitle></DialogHeader>
          {editForm && (
            <div className="grid gap-3">
              <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 p-2">
                Name, code, short code, S.No, category, type and total hours change this subject in <strong>every</strong> department.
                Lecture / tutorial / practical hours and credits apply to <strong>this department</strong> only.
              </p>
              <div className="space-y-1.5">
                <Label>Subject Name</Label>
                <Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Code</Label>
                  <Input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Short Code</Label>
                  <Input value={editForm.shortCode} onChange={(e) => setEditForm({ ...editForm, shortCode: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Second Short Code (optional)</Label>
                  <Input
                    value={editForm.altShortCode}
                    placeholder="Asked when placing in the timetable"
                    onChange={(e) => setEditForm({ ...editForm, altShortCode: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>S.No.</Label>
                  <Input type="number" min={0} value={editForm.serialNumber} onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <select
                    className={SELECT_CLASS}
                    value={editForm.type}
                    onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                  >
                    {Object.entries(SUBJECT_TYPE_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <CategoryField
                  category={editForm.category as SubjectCategory | ""}
                  customCategory={editForm.customCategory}
                  onCategoryChange={(c) => setEditForm({ ...editForm, category: c })}
                  onCustomCategoryChange={(v) => setEditForm({ ...editForm, customCategory: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Total Hours per Semester</Label>
                <Input type="number" min={0} placeholder="Optional" value={editForm.totalHoursPerSemester} onChange={(e) => setEditForm({ ...editForm, totalHoursPerSemester: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Lecture Hours</Label>
                <Input type="number" min={0} value={editForm.lectureHours} onChange={(e) => setEditForm({ ...editForm, lectureHours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Tutorial Hours</Label>
                <Input type="number" min={0} value={editForm.tutorialHours} onChange={(e) => setEditForm({ ...editForm, tutorialHours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Practical Hours</Label>
                <Input type="number" min={0} value={editForm.practicalHours} onChange={(e) => setEditForm({ ...editForm, practicalHours: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Credits</Label>
                <Input type="number" min={0} step="0.5" value={editForm.credits} onChange={(e) => setEditForm({ ...editForm, credits: e.target.value })} />
              </div>
              <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
                <Checkbox
                  checked={editForm.excludeFromTeachingLoad}
                  onCheckedChange={(v) => setEditForm({ ...editForm, excludeFromTeachingLoad: v === true })}
                  aria-label="Don't include in teaching load"
                />
                <span>
                  <span className="font-medium">Don&apos;t include in teaching load</span>
                  <span className="block text-xs text-muted-foreground">
                    e.g. Counselling. It is still assigned, timetabled and attended, but kept off the faculty&apos;s teaching load and resume, and they stay listed as free in those periods.
                  </span>
                </span>
              </label>
            </div>
          )}
          {editError && <p className="text-sm text-red-600">{editError}</p>}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditForm(null)}>Cancel</Button>
            <Button onClick={() => void handleSave()} loading={isSaving}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Delete Dialog */}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete ${deleting?.subjectCode} everywhere?`}
        description="This will permanently delete this subject from the college catalog, along with all department assignments, teaching assignments, and timetable slots everywhere."
        confirmLabel="Delete Everywhere"
        variant="destructive"
        loading={isDeleting}
        onConfirm={() => void handleDelete()}
      />

      {/* Bulk Delete Dialog */}
      <ConfirmDialog
        open={showBulkConfirm}
        onOpenChange={(open) => !open && setShowBulkConfirm(false)}
        title={`Delete ${selectedIds.size} selected subject(s) everywhere?`}
        description="This will permanently delete all selected subjects from the college catalog, along with all department assignments, teaching assignments, and timetable slots everywhere."
        confirmLabel="Delete Everywhere"
        variant="destructive"
        loading={isBulkDeleting}
        onConfirm={() => void handleBulkDelete()}
      />
    </div>
  );
}
