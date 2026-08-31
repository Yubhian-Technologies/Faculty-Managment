"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Send, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { sectionDisplayLabel } from "@/lib/sections/sectionLabel";
import { matchesCurrentSemester } from "@/lib/college/semester";
import type {
  Course, CourseYearTiming, Department, FacultyAssignmentRequest, FacultyMember, Section, Subject, TeachingAssignment,
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
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [faculty, setFaculty] = useState<FacultyMember[]>([]);
  const [assignmentRequests, setAssignmentRequests] = useState<FacultyAssignmentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedSemester, setSelectedSemester] = useState<number | null>(null);
  const [assignForm, setAssignForm] = useState({ sectionId: "", subjectId: "", facultyId: "" });
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
      fetch(`/api/college/subjects?courseId=${encodeURIComponent(courseId)}&year=${encodeURIComponent(year)}`)
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
        setSubjects(subjectsData.subjects ?? []);
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
          fetch(`/api/college/faculty?department=${encodeURIComponent(deptName)}&status=ACTIVE`)
            .then((r) => r.json() as Promise<{ faculty: FacultyMember[] }>)
            .then((d) => setFaculty(d.faculty ?? []))
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

  const gapRows = useMemo(() => subjects.map((subject) => {
    const staffedSectionIds = new Set(
      assignments
        .filter((a) => a.subjectId === subject.id && matchesCurrentSemester(a.timetableSemester, effectiveSemester))
        .map((a) => a.sectionId)
    );
    return { subject, unstaffedSections: sections.filter((s) => !staffedSectionIds.has(s.id)) };
  }), [subjects, sections, assignments, effectiveSemester]);

  const availableSubjectsForAssign = assignForm.sectionId
    ? (() => {
        const selectedSection = sections.find((s) => s.id === assignForm.sectionId);
        return subjects.filter((s) =>
          (!selectedSection?.regulation || !s.regulation || s.regulation === selectedSection.regulation) &&
          !assignments.some((a) =>
            a.sectionId === assignForm.sectionId && a.subjectId === s.id &&
            matchesCurrentSemester(a.timetableSemester, effectiveSemester)
          ) &&
          !pendingRequestKeys.has(`${assignForm.sectionId}_${s.id}`)
        );
      })()
    : subjects;

  // Every top-level department in the college is askable except this
  // section's own - see hod/teaching-assignments/page.tsx's own copy.
  const requestSection = sections.find((s) => s.id === assignForm.sectionId);
  const requestableDepartments = useMemo(
    () => departments.filter((d) => !d.parentDepartmentId && d.name !== requestSection?.department),
    [departments, requestSection]
  );

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId) return;
    setSavingAssignment(true);
    try {
      const fac = faculty.find((f) => f.id === assignForm.facultyId);
      const subj = subjects.find((s) => s.id === assignForm.subjectId);
      const res = await fetch("/api/college/teaching-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId: assignForm.facultyId,
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
        toast({ variant: "destructive", title: "Failed to assign", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Faculty assigned" });
      setAssignForm({ sectionId: assignForm.sectionId, subjectId: "", facultyId: "" });
      load();
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

  async function handleRemove(id: string) {
    try {
      const res = await fetch(`/api/college/teaching-assignments?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Assignment removed" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to remove assignment" });
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
                {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>Semester {s}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Unstaffed Subjects</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
            ) : subjects.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No subjects defined yet for this year.</p>
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
            <form onSubmit={handleAssign} className="space-y-3">
              <div className="space-y-2">
                <Label>Section</Label>
                <Select
                  value={assignForm.sectionId}
                  onValueChange={(v) => setAssignForm({ sectionId: v, subjectId: "", facultyId: "" })}
                >
                  <SelectTrigger><SelectValue placeholder={sections.length ? "Select section" : "No sections for this year"} /></SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => <SelectItem key={s.id} value={s.id}>{sectionDisplayLabel(s, departments)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subject</Label>
                <Select
                  value={assignForm.subjectId}
                  onValueChange={(v) => { setAssignForm((f) => ({ ...f, subjectId: v })); setRequestTargetId(""); }}
                  disabled={!assignForm.sectionId}
                >
                  <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                  <SelectContent>
                    {availableSubjectsForAssign.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">All subjects already staffed for this section</div>
                    )}
                    {availableSubjectsForAssign.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name} ({s.code}{s.regulation ? ` · ${s.regulation}` : ""})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Faculty</Label>
                <Select
                  value={assignForm.facultyId}
                  onValueChange={(v) => setAssignForm((f) => ({ ...f, facultyId: v }))}
                  disabled={!assignForm.subjectId}
                >
                  <SelectTrigger><SelectValue placeholder={faculty.length ? "Select faculty" : "No faculty in your department"} /></SelectTrigger>
                  <SelectContent>
                    {faculty.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                loading={savingAssignment}
                disabled={!assignForm.sectionId || !assignForm.subjectId || !assignForm.facultyId}
              >
                Assign
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
                        {requestableDepartments.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
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
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Section {g.sectionName}</p>
                  <div className="divide-y rounded-md border">
                    {g.items.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-2.5 px-3">
                        <div>
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            {a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span>
                            {a.timetableSemester != null && <Badge variant="outline" className="text-xs">Sem {a.timetableSemester}</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">{a.facultyName} · {a.hoursPerWeek} hrs/wk</p>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => void handleRemove(a.id)}>
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
    </div>
  );
}
