"use client";

import { MAX_FACULTY_PER_SUBJECT } from "@/lib/teaching/facultyCap";
import { useEffect, useMemo, useState } from "react";
import { CustomSubjectAdder } from "@/components/timetable/CustomSubjectAdder";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Send, Trash2, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { matchesCurrentSemester } from "@/lib/college/semester";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { yearSemesterLabelIn } from "@/lib/academic/format";
import type {
  Course, CourseYearTiming, Department, FacultyAssignmentRequest, FacultyMember, Section, Subject, TeachingAssignment, SubjectSemesterAssignment,
} from "@/types";

function statusBadge(status: FacultyAssignmentRequest["status"]) {
  if (status === "ALLOCATED") return <Badge variant="approved">Allocated</Badge>;
  if (status === "DECLINED") return <Badge variant="rejected">Declined</Badge>;
  return <Badge variant="modified">Pending</Badge>;
}

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

interface TeachingAssignmentsEditorProps {
  courseId: string;
  year: string;
  backHref: string;
}

// Shared logic behind hod/timetable/[courseId]/[year]/teaching-assignments,
// panel/timetable-incharge/[courseId]/[year]/teaching-assignments and
// college-staff/timetable-incharge/[courseId]/[year]/teaching-assignments -
// same extraction pattern as TimetableGridEditor. Deliberately no
// Course/Year/Department pickers (unlike hod/teaching-assignments/page.tsx's
// full department-tree browser): every caller here already has exactly one
// course-year in scope, so the page just gets straight to it. Works
// identically for an HOD (full access) and a delegated Timetable Incharge
// (teaching faculty or Technical supporting staff, see TimetableIncharge in
// src/types/core.ts) - the underlying API routes authorize both the same way.
export function TeachingAssignmentsEditor({ courseId, year, backHref }: TeachingAssignmentsEditorProps) {
  const router = useRouter();
  const { user } = useAuth();

  const [course, setCourse] = useState<Course | null>(null);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [masterSubjects, setMasterSubjects] = useState<Subject[]>([]);
  const [semesterAssignments, setSemesterAssignments] = useState<SubjectSemesterAssignment[]>([]);
  const [isLoadingSemesterAssignments, setIsLoadingSemesterAssignments] = useState(false);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  // `name` is the derived display name (facultyDisplayName), not a stored field.
  const [faculty, setFaculty] = useState<(FacultyMember & { name: string })[]>([]);
  const [assignmentRequests, setAssignmentRequests] = useState<FacultyAssignmentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [assignForm, setAssignForm] = useState({ sectionId: "", subjectId: "", facultyId: "" });
  // More faculty for the same subject + section, added with "+ Add another faculty" (the first is assignForm.facultyId).
  const [extraFacultyIds, setExtraFacultyIds] = useState<string[]>([]);
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [requestTargetId, setRequestTargetId] = useState("");
  const [sendingRequest, setSendingRequest] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses: Course[] }>),
      fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
      fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
        .then((r) => r.json() as Promise<{ sections: Section[] }>),
      fetch(`/api/college/subjects?courseId=${encodeURIComponent(courseId)}`)
        .then((r) => r.json() as Promise<{ subjects: Subject[] }>),
      fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(courseId)}`)
        .then((r) => r.json() as Promise<{ timings: CourseYearTiming[] }>),
      fetch(`/api/college/teaching-assignments?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
        .then((r) => r.json() as Promise<{ assignments: TeachingAssignment[] }>),
      // Scoped server-side to this caller's own outgoing requests (an HOD
      // also gets their department's incoming mailbox back, harmlessly
      // filtered out below since only outgoing ones are ever rendered here -
      // see faculty-assignment-requests/route.ts GET).
      fetch("/api/college/faculty-assignment-requests")
        .then((r) => r.json() as Promise<{ requests: FacultyAssignmentRequest[] }>),
    ])
      .then(([coursesData, deptsData, sectionsData, subjectsData, timingsData, assignData, requestsData]) => {
        const foundCourse = (coursesData.courses ?? []).find((c) => c.id === courseId) ?? null;
        setCourse(foundCourse);
        setDepartments(deptsData.departments ?? []);
        setSections((sectionsData.sections ?? []).sort((a, b) => a.name.localeCompare(b.name)));
        setMasterSubjects(subjectsData.subjects ?? []);
        // Refined by catalogId once the course (and its catalogId) resolves -
        // the initial fetch above had to go out before that, so it's
        // courseId-only. A master subject is department-independent (see
        // /api/college/subjects GET's own doc-comment), physically filed
        // under whichever ONE department's Course doc created it, so the
        // courseId-only fetch can miss one legitimately assigned to this
        // course-year (masterSubjects is only ever used here as a
        // supplemental hoursPerWeek fallback, but a missing entry there still
        // means a wrong/zero hoursPerWeek gets sent on assign).
        if (foundCourse?.catalogId) {
          fetch(`/api/college/subjects?catalogId=${encodeURIComponent(foundCourse.catalogId)}`)
            .then((r) => r.json() as Promise<{ subjects: Subject[] }>)
            .then((d) => setMasterSubjects(d.subjects ?? []))
            .catch(() => { /* non-critical - courseId-only list already set above */ });
        }
        setTimings((timingsData.timings ?? []).filter((t) => t.year === Number(year)));
        setAssignments(assignData.assignments ?? []);
        setAssignmentRequests(requestsData.requests ?? []);
        const deptName = foundCourse ? deptsData.departments?.find((d: Department) => d.id === foundCourse.departmentId)?.name : undefined;
        if (deptName) {
          // A parent HOD's true sub-departments are staffable directly here
          // too, same as hod/teaching-assignments - a grouped/managed "core"
          // branch's faculty never are (see canHodManageFacultyDepartment,
          // lib/departments/scope.ts), so the lend/request flow below is the
          // actual path to staff one. Only affects HOD sessions; the
          // Timetable Incharge (PANEL_MEMBER/COLLEGE_STAFF) branch of
          // college/faculty/route.ts already restricts to just their own
          // department regardless.
          fetch(`/api/college/faculty?department=${encodeURIComponent(deptName)}&availableOnly=true`)
            .then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>)
            .then((d) => setFaculty((d.faculty ?? []).map((f) => ({ ...f, name: facultyDisplayName(f) }))))
            .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }));
        }
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load teaching assignments" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Wrapped so load()'s setState calls aren't reachable synchronously from
    // the effect body (react-hooks/set-state-in-effect).
    void (async () => { load(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, year]);

  const semesterOptions = useMemo(() => {
    const nums = new Set<number>();
    for (const t of timings) for (const s of t.semesters ?? []) nums.add(s.semester);
    return Array.from(nums).sort((a, b) => a - b);
  }, [timings]);
  const effectiveSemester = semesterOptions.length === 0
    ? null
    : selectedSemester != null && semesterOptions.includes(selectedSemester)
      ? selectedSemester
      : semesterOptions[0];

  // Fetch subjects assigned to this specific semester and year by Dean Academics
  useEffect(() => {
    if (!courseId || effectiveSemester == null) {
      setSemesterAssignments([]);
      return;
    }
    let cancelled = false;
    setIsLoadingSemesterAssignments(true);
    fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}&semester=${effectiveSemester}`)
      .then((r) => r.json() as Promise<{ assignments?: SubjectSemesterAssignment[] }>)
      .then((d) => {
        if (!cancelled) {
          setSemesterAssignments(d.assignments ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) setSemesterAssignments([]);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSemesterAssignments(false);
      });
    return () => { cancelled = true; };
  }, [courseId, year, effectiveSemester]);

  // Narrow master subjects down to ONLY subjects assigned by Dean Academics for this course, year, and semester
  const assignedSubjects = useMemo(() => {
    if (effectiveSemester == null) return [];

    // Relevant department IDs and names for this course and its sections
    const validDeptIds = new Set<string>();
    if (course?.departmentId) validDeptIds.add(course.departmentId);
    for (const s of sections) {
      const d = departments.find((dept) => dept.name === s.department);
      if (d) validDeptIds.add(d.id);
    }
    const validDeptNames = new Set<string>();
    for (const s of sections) if (s.department) validDeptNames.add(s.department);
    const courseDept = departments.find((d) => d.id === course?.departmentId);
    if (courseDept) validDeptNames.add(courseDept.name);

    // Filter to assignments matching this semester and year, and matching department scope
    const matchingAssignments = semesterAssignments.filter((a) => {
      if (a.semester !== effectiveSemester) return false;
      if (a.year != null && a.year !== Number(year)) return false;
      const aDeptName = a.departmentName ?? a.department;
      if (validDeptIds.size > 0 && a.departmentId && !validDeptIds.has(a.departmentId)) {
        if (!aDeptName || !validDeptNames.has(aDeptName)) return false;
      }
      return true;
    });

    const assignedSubjectIds = new Set(matchingAssignments.map((a) => a.subjectId));
    const resolved = masterSubjects.filter((s) => assignedSubjectIds.has(s.id));

    // Fallback if masterSubjects doesn't yet contain a newly assigned subject
    const resolvedIds = new Set(resolved.map((s) => s.id));
    for (const a of matchingAssignments) {
      if (!resolvedIds.has(a.subjectId)) {
        resolved.push({
          id: a.subjectId,
          name: a.subjectName,
          code: a.subjectCode,
          collegeId: a.collegeId ?? "",
          courseId: a.courseId,
          hoursPerWeek: 0,
          credits: 0,
          type: "THEORY",
          isActive: true,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
        } as Subject);
        resolvedIds.add(a.subjectId);
      }
    }
    return resolved;
  }, [effectiveSemester, semesterAssignments, year, course, sections, departments, masterSubjects]);

  // This course-year's own OUTGOING requests only - the API already scopes a
  // Timetable Incharge caller to their own sent requests, but an HOD caller
  // gets their whole department's mailbox back (incoming + every other
  // course-year's outgoing), so both dimensions are re-narrowed here: this
  // exact course-year, and only ones this session actually sent (never an
  // incoming request to fulfil - that stays on the full hod/assignment-requests
  // page, not this course-year-scoped view).
  const myOutgoingRequests = useMemo(
    () => assignmentRequests.filter((r) => r.courseId === courseId && r.year === Number(year) && r.requestedBy === user?.uid),
    [assignmentRequests, courseId, year, user?.uid]
  );

  // sectionId_subjectId pairs with a PENDING lend-request already out - see
  // hod/teaching-assignments/page.tsx's own copy of this same guard.
  const pendingRequestKeys = useMemo(
    () => new Set(myOutgoingRequests.filter((r) => r.status === "PENDING").map((r) => `${r.sectionId}_${r.subjectId}`)),
    [myOutgoingRequests]
  );

  // Unstaffed subjects: only checks sections of the department(s) to which the subject was assigned
  const gapRows = useMemo(() => assignedSubjects.map((subject) => {
    const subjectDeptIds = new Set(
      semesterAssignments
        .filter((a) => a.subjectId === subject.id && a.semester === effectiveSemester)
        .map((a) => a.departmentId)
        .filter(Boolean)
    );
    const subjectDeptNames = new Set(
      semesterAssignments
        .filter((a) => a.subjectId === subject.id && a.semester === effectiveSemester)
        .map((a) => a.departmentName ?? a.department)
        .filter(Boolean)
    );

    const relevantSections = sections.filter((s) => {
      if (subjectDeptIds.size === 0 && subjectDeptNames.size === 0) return true;
      const d = departments.find((dept) => dept.name === s.department);
      if (d && subjectDeptIds.has(d.id)) return true;
      if (s.department && subjectDeptNames.has(s.department)) return true;
      return false;
    });

    const staffedSectionIds = new Set(
      assignments
        .filter((a) => a.subjectId === subject.id && matchesCurrentSemester(a.timetableSemester, effectiveSemester))
        .map((a) => a.sectionId)
    );
    return { subject, unstaffedSections: relevantSections.filter((s) => !staffedSectionIds.has(s.id)) };
  }), [assignedSubjects, semesterAssignments, effectiveSemester, sections, departments, assignments]);

  // Available subjects for assignment: narrowed specifically to the chosen section's department, year, and semester
  const availableSubjectsForAssign = useMemo(() => {
    if (!assignForm.sectionId) return assignedSubjects;
    const selectedSection = sections.find((s) => s.id === assignForm.sectionId);
    if (!selectedSection) return assignedSubjects;

    const sectionDept = departments.find((d) => d.name === selectedSection.department);
    const sectionDeptId = sectionDept?.id;

    const sectionAssignedSubjectIds = new Set(
      semesterAssignments
        .filter((a) => {
          if (a.semester !== effectiveSemester) return false;
          if (a.year != null && a.year !== Number(year)) return false;
          if (sectionDeptId && a.departmentId) return a.departmentId === sectionDeptId;
          const aDeptName = a.departmentName ?? a.department;
          if (selectedSection.department && aDeptName) return aDeptName === selectedSection.department;
          // No department info on this assignment row at all - never
          // assumed to belong to this section. A subject nobody mapped to
          // this section's department shouldn't be offered here just
          // because the mapping is ambiguous.
          return false;
        })
        .map((a) => a.subjectId)
    );

    // Check if any subjects assigned to this department match the section's regulation
    const hasRegulationMatches = assignedSubjects.some(
      (s) =>
        sectionAssignedSubjectIds.has(s.id) &&
        (!selectedSection.regulation || !s.regulation || s.regulation === selectedSection.regulation)
    );

    return assignedSubjects.filter((s) => {
      if (!sectionAssignedSubjectIds.has(s.id)) return false;
      if (hasRegulationMatches && selectedSection.regulation && s.regulation && s.regulation !== selectedSection.regulation) {
        return false;
      }
      if (pendingRequestKeys.has(`${assignForm.sectionId}_${s.id}`)) return false;
      const existingForSubject = assignments.filter((a) =>
        a.sectionId === assignForm.sectionId && a.subjectId === s.id &&
        matchesCurrentSemester(a.timetableSemester, effectiveSemester)
      );
      // A subject keeps showing until it has the most faculty allowed, so more can be added.
      return existingForSubject.length < MAX_FACULTY_PER_SUBJECT;
    });
  }, [assignForm.sectionId, sections, departments, semesterAssignments, effectiveSemester, year, assignedSubjects, pendingRequestKeys, assignments]);

  // Every department in the college is askable except this section's own -
  // see hod/teaching-assignments/page.tsx's own copy. Sub-departments are NOT
  // excluded as a class: a true sub-department (e.g. BS-Chemistry,
  // BS-Physics under parent Basic Science) runs its own faculty roster under
  // its own HOD login exactly like a top-level department does, so it needs
  // to be askable too - this used to only offer top-level departments,
  // leaving no way to request from a sibling sub-department.
  const requestSection = sections.find((s) => s.id === assignForm.sectionId);
  const requestableDepartments = useMemo(
    () => departments.filter((d) => d.name !== requestSection?.department),
    [departments, requestSection]
  );

  // Faculty already assigned to the picked subject in this section (and semester) are not offered again.
  const alreadyOnSubject = new Set(
    assignments
      .filter((a) => a.sectionId === assignForm.sectionId && a.subjectId === assignForm.subjectId && matchesCurrentSemester(a.timetableSemester, effectiveSemester))
      .map((a) => a.facultyId),
  );
  const availableFacultyForAssign = faculty.filter((f) => !alreadyOnSubject.has(f.id));

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId) return;
    setSavingAssignment(true);
    try {
      const subj = assignedSubjects.find((s) => s.id === assignForm.subjectId) ?? masterSubjects.find((s) => s.id === assignForm.subjectId);
      // One assignment per chosen faculty, in the order picked; a failure stops the rest and says which one.
      const ids = Array.from(new Set([assignForm.facultyId, ...extraFacultyIds].filter(Boolean)));
      let done = 0;
      for (const facultyId of ids) {
        const fac = faculty.find((f) => f.id === facultyId);
        const res = await fetch("/api/college/teaching-assignments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            facultyId,
            facultyName: fac?.name ?? "",
            courseId,
            sectionId: assignForm.sectionId,
            subjectId: assignForm.subjectId,
            hoursPerWeek: subj?.hoursPerWeek,
            ...(effectiveSemester != null ? { timetableSemester: effectiveSemester } : {}),
          }),
        });
        const json = await res.json() as { error?: string };
        if (!res.ok) {
          toast({ variant: "destructive", title: `Failed to assign ${fac?.name ?? "faculty"}`, description: json.error });
          break;
        }
        done++;
      }
      if (done > 0) {
        toast({ variant: "success", title: done === 1 ? "Faculty assigned" : `${done} faculty assigned` });
        setAssignForm({ sectionId: assignForm.sectionId, subjectId: "", facultyId: "" });
        setExtraFacultyIds([]);
        load();
      }
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingAssignment(false);
    }
  }

  async function handleSendRequest() {
    if (!assignForm.sectionId || !assignForm.subjectId || !requestTargetId) return;
    setSendingRequest(true);
    try {
      const res = await fetch("/api/college/faculty-assignment-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId,
          sectionId: assignForm.sectionId,
          subjectId: assignForm.subjectId,
          targetDepartmentId: requestTargetId,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to send request", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Request sent" });
      setRequestTargetId("");
      // The subject just requested drops out of availableSubjectsForAssign
      // (see pendingRequestKeys) the moment assignmentRequests refreshes -
      // clear it here too so the form doesn't sit on a now-invalid selection.
      setAssignForm((f) => ({ ...f, subjectId: "" }));
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSendingRequest(false);
    }
  }

  // Removing an assignment also deletes its timetable slots, so it is asked
  // about first rather than happening on the click (see ConfirmDialog below).
  const [removeTarget, setRemoveTarget] = useState<TeachingAssignment | null>(null);
  const [removing, setRemoving] = useState(false);

  // Clears a whole section at once - its assignments AND the timetable booked
  // for them (same endpoint as "Delete entire timetable" in the Timetable tab).
  const [resetTarget, setResetTarget] = useState<{ sectionId: string; sectionName: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  async function handleResetSection(sectionId: string) {
    setResetting(true);
    try {
      const semesterQuery = effectiveSemester != null ? `&semester=${effectiveSemester}` : "";
      const res = await fetch(`/api/college/timetable/reset?sectionId=${encodeURIComponent(sectionId)}${semesterQuery}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({})) as { error?: string; removedAssignments?: number };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to delete assignments", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Section cleared", description: `${json.removedAssignments ?? 0} assignment(s) and their timetable removed.` });
      setResetTarget(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete assignments" });
    } finally {
      setResetting(false);
    }
  }

  async function handleRemove(id: string) {
    setRemoving(true);
    try {
      const res = await fetch(`/api/college/teaching-assignments?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        toast({ variant: "destructive", title: "Failed to remove assignment", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Assignment removed" });
      setRemoveTarget(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to remove assignment" });
    } finally {
      setRemoving(false);
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, { sectionId: string; sectionName: string; items: TeachingAssignment[] }>();
    for (const a of assignments) {
      if (!a.sectionId) continue;
      if (!map.has(a.sectionId)) map.set(a.sectionId, { sectionId: a.sectionId, sectionName: a.sectionName ?? "", items: [] });
      map.get(a.sectionId)!.items.push(a);
    }
    return Array.from(map.values()).sort((a, b) => a.sectionName.localeCompare(b.sectionName));
  }, [assignments]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={course ? `${course.name} · ${ordinalYear(Number(year))} · Teaching Assignments` : "Teaching Assignments"}
        description="Find staffing gaps and assign faculty to subjects"
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {semesterOptions.length > 0 && (
        <Card>
          <CardContent className="p-4 max-w-xs">
            <Label>Semester</Label>
            <Select value={String(effectiveSemester ?? "")} onValueChange={(v) => setSelectedSemester(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
              <SelectContent>
                {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>{yearSemesterLabelIn(Number(year), semesterOptions, s)}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Unstaffed Subjects</CardTitle></CardHeader>
          <CardContent>
            {isLoading || isLoadingSemesterAssignments ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
            ) : assignedSubjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No subjects assigned by Dean Academics for this semester yet.</p>
            ) : sections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No sections created yet for this year.</p>
            ) : (
              <div className="space-y-3">
                {gapRows.map(({ subject, unstaffedSections }) => (
                  <div key={subject.id} className="rounded-md border p-2.5">
                    <p className="text-sm font-medium">{subject.name} <span className="text-muted-foreground">({subject.code})</span></p>
                    {unstaffedSections.length === 0 ? (
                      <Badge variant="approved" className="mt-1.5">Fully staffed</Badge>
                    ) : (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {unstaffedSections.map((s) => (
                          <Badge key={s.id} variant="rejected">{sectionDisplayLabel(s, departments)} unstaffed</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Assign Faculty</CardTitle></CardHeader>
          <CardContent>
            {sections.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No sections created yet for this year.</p>
            ) : (
            <form onSubmit={handleAssign} className="space-y-3">
              <div className="space-y-2">
                <Label>Section</Label>
                <Select
                  value={assignForm.sectionId}
                  onValueChange={(v) => { setAssignForm({ sectionId: v, subjectId: "", facultyId: "" }); setExtraFacultyIds([]); }}
                >
                  <SelectTrigger><SelectValue placeholder={sections.length ? "Select section" : "No sections for this year"} /></SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* Works on an empty section too, so its old requests can be cleared. */}
                {assignForm.sectionId && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() => {
                      const sec = sections.find((x) => x.id === assignForm.sectionId);
                      setResetTarget({ sectionId: assignForm.sectionId, sectionName: sec?.name ?? "" });
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />Clear assignments &amp; requests for this section
                  </Button>
                )}
              </div>
              <div className="space-y-2">
                <Label>Subject</Label>
                <Select
                  value={assignForm.subjectId}
                  onValueChange={(v) => { setAssignForm((f) => ({ ...f, subjectId: v, facultyId: "" })); setExtraFacultyIds([]); setRequestTargetId(""); }}
                  disabled={!assignForm.sectionId}
                >
                  <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                  <SelectContent>
                    {availableSubjectsForAssign.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        {assignedSubjects.length === 0
                          ? "No subjects assigned to this department for this semester"
                          : "All subjects already staffed for this section"}
                      </div>
                    )}
                    {availableSubjectsForAssign.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} ({s.shortCode || s.code}{s.regulation ? ` · ${s.regulation}` : ""})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CustomSubjectAdder
                  courseId={courseId}
                  sectionId={assignForm.sectionId}
                  semester={effectiveSemester}
                  onAdded={({ subject, assignment }) => {
                    setMasterSubjects((p) => [...p, subject]);
                    setSemesterAssignments((p) => [...p, assignment]);
                    setAssignForm((f) => ({ ...f, subjectId: subject.id }));
                  }}
                />
              </div>
              <div className="space-y-2">
                <Label>Faculty</Label>
                <Select
                  value={assignForm.facultyId}
                  onValueChange={(v) => { setAssignForm((f) => ({ ...f, facultyId: v })); setExtraFacultyIds((ids) => ids.filter((id) => id !== v)); }}
                  disabled={!assignForm.subjectId}
                >
                  <SelectTrigger><SelectValue placeholder={availableFacultyForAssign.length ? "Select faculty" : "No faculty in your department"} /></SelectTrigger>
                  <SelectContent>
                    {availableFacultyForAssign.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>

                {/* More faculty for the same subject in this section - each picks from
                    whoever is not already chosen here or assigned to it. */}
                {extraFacultyIds.map((id, i) => {
                  const chosenElsewhere = new Set([assignForm.facultyId, ...extraFacultyIds.filter((_, j) => j !== i)]);
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <Select value={id} onValueChange={(v) => setExtraFacultyIds((ids) => ids.map((x, j) => (j === i ? v : x)))}>
                        <SelectTrigger><SelectValue placeholder="Select faculty" /></SelectTrigger>
                        <SelectContent>
                          {availableFacultyForAssign.filter((f) => !chosenElsewhere.has(f.id)).map((f) => (
                            <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button type="button" size="icon" variant="ghost" title="Remove this faculty" onClick={() => setExtraFacultyIds((ids) => ids.filter((_, j) => j !== i))}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !assignForm.facultyId ||
                    extraFacultyIds.some((id) => !id) ||
                    availableFacultyForAssign.length <= 1 + extraFacultyIds.length ||
                    1 + extraFacultyIds.length + alreadyOnSubject.size >= MAX_FACULTY_PER_SUBJECT
                  }
                  onClick={() => setExtraFacultyIds((ids) => [...ids, ""])}
                >
                  <Plus className="mr-1.5 h-4 w-4" />Add another faculty
                </Button>
              </div>
              <Button
                type="submit"
                loading={savingAssignment}
                disabled={!assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId || extraFacultyIds.some((id) => !id)}
              >
                {extraFacultyIds.length > 0 ? `Assign ${1 + extraFacultyIds.length} faculty` : "Assign"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Periods for this subject are picked afterwards from the Timetable tab.
              </p>

              {assignForm.sectionId && assignForm.subjectId && (
                <div className="pt-3 mt-3 border-t space-y-2">
                  <Label>Or ask another department to lend a faculty member</Label>
                  <div className="flex flex-wrap gap-2">
                    <Select value={requestTargetId} onValueChange={setRequestTargetId}>
                      <SelectTrigger className="flex-1 min-w-48">
                        <SelectValue placeholder={requestableDepartments.length ? "Select department" : "No other departments"} />
                      </SelectTrigger>
                      <SelectContent>
                        {requestableDepartments.map((d) => {
                          const parentName = d.parentDepartmentId
                            ? departments.find((p) => p.id === d.parentDepartmentId)?.name
                            : null;
                          return (
                            <SelectItem key={d.id} value={d.id}>
                              {d.name}{parentName ? ` (${parentName})` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      loading={sendingRequest}
                      disabled={!requestTargetId}
                      onClick={() => void handleSendRequest()}
                    >
                      <Send className="h-4 w-4 mr-2" />Send Request
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    They&rsquo;ll pick one of their own faculty for it - track its status below.
                  </p>
                </div>
              )}
            </form>
            )}
          </CardContent>
        </Card>
      </div>

      {myOutgoingRequests.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Sent Requests</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {myOutgoingRequests.map((r) => (
                <div key={r.id} className="rounded-md border p-3 flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-medium">
                      {r.subjectName} <span className="text-muted-foreground">({r.subjectCode})</span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Section {r.sectionName} · Sent to {r.targetDepartmentName}
                    </p>
                    {r.status === "ALLOCATED" && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Allocated: <span className="text-foreground font-medium">{r.allocatedFacultyName}</span>
                      </p>
                    )}
                    {r.status === "DECLINED" && r.declineReason && (
                      <p className="text-xs text-muted-foreground mt-0.5">Reason: {r.declineReason}</p>
                    )}
                  </div>
                  {statusBadge(r.status)}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Current Assignments</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No teaching assignments yet.</p>
          ) : (
            <div className="space-y-5">
              {groups.map((g) => (
                <div key={g.sectionId}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Section {g.sectionName}</p>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setResetTarget({ sectionId: g.sectionId, sectionName: g.sectionName })}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />Delete all
                    </Button>
                  </div>
                  <div className="divide-y rounded-md border">
                    {g.items.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2.5 px-3">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            {a.subjectName} <span className="text-muted-foreground">({a.shortCode || a.subjectCode})</span>
                            {a.timetableSemester != null && <Badge variant="outline" className="text-xs">Sem {a.timetableSemester}</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">{a.facultyName} · {a.hoursPerWeek} hrs/wk</p>
                        </div>
                        <Button size="sm" variant="ghost" title="Remove assignment" onClick={() => setRemoveTarget(a)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!resetTarget}
        onOpenChange={(open) => { if (!open && !resetting) setResetTarget(null); }}
        title="Delete every assignment for this section?"
        description={
          resetTarget
            ? `All current teaching assignments for Section ${resetTarget.sectionName} the whole timetable booked for them (published and draft) and any open assignment requests are removed, so every subject shows fresh and unstaffed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete all"
        variant="destructive"
        loading={resetting}
        onConfirm={() => { if (resetTarget) void handleResetSection(resetTarget.sectionId); }}
      />
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => { if (!open && !removing) setRemoveTarget(null); }}
        title="Remove this assignment?"
        description={
          removeTarget
            ? `${removeTarget.facultyName} will no longer teach ${removeTarget.subjectName} for Section ${removeTarget.sectionName ?? ""}. `
              + "Every timetable period booked for it is removed too. This cannot be undone."
            : undefined
        }
        confirmLabel="Remove"
        variant="destructive"
        loading={removing}
        onConfirm={() => { if (removeTarget) void handleRemove(removeTarget.id); }}
      />
    </div>
  );
}
