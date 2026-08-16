"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Lock, Pencil, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/useToast";
import type { StudentAttendanceMark, StudentAttendanceSession, TeachingAssignment } from "@/types";

interface Option {
  value: string;
  label: string;
}

// Teaching assignments come in two shapes (see TeachingAssignment): course/
// section-scoped ones carry courseId/year and a real sectionId; semester-
// scoped ones (HOD's "Teaching Assignments" page) carry academicYear/semester
// and only a free-text section name. These helpers unify either shape into
// one selectable option per dropdown level.
function courseKeyOf(a: TeachingAssignment): string {
  return a.courseId ?? `nocourse:${a.courseName ?? ""}`;
}
function courseLabelOf(a: TeachingAssignment): string {
  return a.courseName?.trim() || "General";
}

function semesterKeyOf(a: TeachingAssignment): string {
  return a.sectionId ? `year:${a.year ?? ""}` : `sem:${a.academicYear ?? ""}:${a.semester ?? ""}`;
}
function semesterLabelOf(a: TeachingAssignment): string {
  if (a.sectionId) return `Year ${a.year ?? "?"}`;
  const term = [a.academicYear, a.semester ? `Semester ${a.semester}` : ""].filter(Boolean).join(" · ");
  return term || "Semester";
}

function sectionKeyOf(a: TeachingAssignment): string {
  return a.sectionId ?? `sem:${a.department}:${a.section ?? ""}:${a.academicYear ?? ""}:${a.semester ?? ""}`;
}
function sectionLabelOf(a: TeachingAssignment): string {
  if (a.sectionId) return a.sectionName ?? "Section";
  return a.section?.trim() || "Section";
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

// The faculty picks exactly one of these four modes to mark the whole class
// in one step: the two "Check ..." modes start everyone on the opposite
// status and let the faculty flip just the exceptions; the two "Mark All ..."
// modes apply a single status to everyone immediately (attendance is
// complete as soon as the mode is picked).
type AttendanceMode = "PRESENTEES" | "ABSENTEES" | "ALL_PRESENT" | "ALL_ABSENT";

function checkedMeaningFor(mode: AttendanceMode | null): StudentAttendanceMark {
  return mode === "ABSENTEES" || mode === "ALL_ABSENT" ? "ABSENT" : "PRESENT";
}

function defaultFillFor(mode: AttendanceMode): StudentAttendanceMark {
  switch (mode) {
    case "ALL_PRESENT": return "PRESENT";
    case "ALL_ABSENT": return "ABSENT";
    case "PRESENTEES": return "ABSENT"; // starts absent; faculty checks the present ones
    case "ABSENTEES": return "PRESENT"; // starts present; faculty checks the absent ones
  }
}

export default function MarkAttendancePage() {
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);

  const [course, setCourse] = useState("");
  const [semesterKey, setSemesterKey] = useState("");
  const [branch, setBranch] = useState("");
  const [sectionKey, setSectionKey] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [date, setDate] = useState(todayStr());

  const [attendanceSession, setAttendanceSession] = useState<StudentAttendanceSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [draft, setDraft] = useState<Record<string, StudentAttendanceMark | null>>({});
  const [mode, setMode] = useState<AttendanceMode | null>(null);
  const [classNotes, setClassNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoadingAssignments(true);
      try {
        const res = await fetch("/api/college/teaching-assignments");
        if (!res.ok) throw new Error("Failed to load teaching assignments");
        const json = (await res.json()) as { assignments?: TeachingAssignment[] };
        setAssignments((json.assignments ?? []).filter((a) => !a.isPast));
      } catch {
        toast({ variant: "destructive", title: "Failed to load your teaching assignments" });
      } finally {
        setIsLoadingAssignments(false);
      }
    })();
  }, []);

  const courseOptions = useMemo<Option[]>(() => {
    const seen = new Map<string, Option>();
    assignments.forEach((a) => {
      const key = courseKeyOf(a);
      if (!seen.has(key)) seen.set(key, { value: key, label: courseLabelOf(a) });
    });
    return [...seen.values()];
  }, [assignments]);

  const semesterOptions = useMemo<Option[]>(() => {
    const seen = new Map<string, Option>();
    assignments
      .filter((a) => courseKeyOf(a) === course)
      .forEach((a) => {
        const key = semesterKeyOf(a);
        if (!seen.has(key)) seen.set(key, { value: key, label: semesterLabelOf(a) });
      });
    return [...seen.values()];
  }, [assignments, course]);

  const branchOptions = useMemo<Option[]>(() => {
    const seen = new Set<string>();
    assignments
      .filter((a) => courseKeyOf(a) === course && semesterKeyOf(a) === semesterKey)
      .forEach((a) => a.department && seen.add(a.department));
    return [...seen].sort().map((b) => ({ value: b, label: b }));
  }, [assignments, course, semesterKey]);

  const sectionOptions = useMemo<Option[]>(() => {
    const seen = new Map<string, Option>();
    assignments
      .filter((a) => courseKeyOf(a) === course && semesterKeyOf(a) === semesterKey && a.department === branch)
      .forEach((a) => {
        const key = sectionKeyOf(a);
        if (!seen.has(key)) seen.set(key, { value: key, label: sectionLabelOf(a) });
      });
    return [...seen.values()];
  }, [assignments, course, semesterKey, branch]);

  const subjectOptions = useMemo<Option[]>(() => {
    const seen = new Map<string, Option>();
    assignments
      .filter(
        (a) =>
          courseKeyOf(a) === course &&
          semesterKeyOf(a) === semesterKey &&
          a.department === branch &&
          sectionKeyOf(a) === sectionKey
      )
      .forEach((a) => seen.set(a.subjectId, { value: a.subjectId, label: `${a.subjectName} (${a.subjectCode})` }));
    return [...seen.values()];
  }, [assignments, course, semesterKey, branch, sectionKey]);

  // The exact assignment the current Course+Semester+Branch+Section+Subject
  // selection maps to — its own id is what the API keys the attendance
  // session off.
  const selectedAssignment = useMemo(
    () =>
      assignments.find(
        (a) =>
          courseKeyOf(a) === course &&
          semesterKeyOf(a) === semesterKey &&
          a.department === branch &&
          sectionKeyOf(a) === sectionKey &&
          a.subjectId === subjectId
      ) ?? null,
    [assignments, course, semesterKey, branch, sectionKey, subjectId]
  );

  function resetSession() {
    setAttendanceSession(null);
    setLoadError(null);
    setDraft({});
    setMode(null);
    setClassNotes("");
  }

  function handleCourseChange(v: string) {
    setCourse(v);
    setSemesterKey("");
    setBranch("");
    setSectionKey("");
    setSubjectId("");
    resetSession();
  }
  function handleSemesterChange(v: string) {
    setSemesterKey(v);
    setBranch("");
    setSectionKey("");
    setSubjectId("");
    resetSession();
  }
  function handleBranchChange(v: string) {
    setBranch(v);
    setSectionKey("");
    setSubjectId("");
    resetSession();
  }
  function handleSectionChange(v: string) {
    setSectionKey(v);
    setSubjectId("");
    resetSession();
  }
  function handleSubjectChange(v: string) {
    setSubjectId(v);
    resetSession();
  }

  async function handleLoadStudents() {
    if (!selectedAssignment || !date) return;
    setIsLoadingStudents(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/college/student-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: selectedAssignment.id, date }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (!res.ok || !json.session) {
        setLoadError(json.error ?? "Failed to load students");
        return;
      }
      setAttendanceSession(json.session);
      setDraft(Object.fromEntries(json.session.entries.map((e) => [e.studentId, e.status])));
      setClassNotes(json.session.classNotes ?? "");
    } catch {
      setLoadError("Failed to load students");
    } finally {
      setIsLoadingStudents(false);
    }
  }

  // Only one of the four modes is active at a time. Picking a mode fills
  // every row with that mode's default status immediately — for "Mark All
  // ..." that's the whole class in one shot; for "Check ..." it's a starting
  // point the faculty then flips exceptions on. Un-picking the active mode
  // just hides the row checkboxes again without touching what's been marked.
  function handleModeToggle(next: AttendanceMode, checked: boolean) {
    if (!attendanceSession) return;
    if (checked) {
      setMode(next);
      setDraft(
        Object.fromEntries(attendanceSession.entries.map((e) => [e.studentId, defaultFillFor(next)]))
      );
    } else {
      setMode((prev) => (prev === next ? null : prev));
    }
  }

  function handleRowCheck(studentId: string, checked: boolean) {
    const meaning = checkedMeaningFor(mode);
    const opposite: StudentAttendanceMark = meaning === "PRESENT" ? "ABSENT" : "PRESENT";
    setDraft((prev) => ({ ...prev, [studentId]: checked ? meaning : opposite }));
  }

  const markedCount = attendanceSession
    ? attendanceSession.entries.filter((e) => draft[e.studentId] != null).length
    : 0;
  const allMarked =
    !!attendanceSession && attendanceSession.totalStudents > 0 && markedCount === attendanceSession.totalStudents;
  const isReadOnly = attendanceSession?.status === "SUBMITTED";
  const presentCount = attendanceSession
    ? attendanceSession.entries.filter((e) => draft[e.studentId] === "PRESENT").length
    : 0;

  async function handleSubmit() {
    if (!attendanceSession || !allMarked) return;
    setIsSubmitting(true);
    try {
      const entries = attendanceSession.entries.map((e) => ({
        studentId: e.studentId,
        status: draft[e.studentId] ?? null,
      }));
      const res = await fetch(`/api/college/student-attendance/${attendanceSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, classNotes, submit: true }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (!res.ok || !json.session) throw new Error(json.error ?? "Failed to submit attendance");
      setAttendanceSession(json.session);
      toast({ variant: "success", title: "Attendance submitted successfully" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit attendance" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Select the class details and mark students present or absent. Once submitted, attendance cannot be edited."
      />

      {isLoadingAssignments ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You have no teaching assignments yet. Ask your HOD to assign you to a section and subject
            before taking attendance.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:items-end">
                <div className="space-y-2">
                  <Label>Course</Label>
                  <Select value={course} onValueChange={handleCourseChange}>
                    <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                    <SelectContent>
                      {courseOptions.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Semester</Label>
                  <Select value={semesterKey} onValueChange={handleSemesterChange} disabled={!course}>
                    <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                    <SelectContent>
                      {semesterOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select value={branch} onValueChange={handleBranchChange} disabled={!semesterKey}>
                    <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                    <SelectContent>
                      {branchOptions.map((b) => (
                        <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Section</Label>
                  <Select value={sectionKey} onValueChange={handleSectionChange} disabled={!branch}>
                    <SelectTrigger><SelectValue placeholder="Select section" /></SelectTrigger>
                    <SelectContent>
                      {sectionOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Subject</Label>
                  <Select value={subjectId} onValueChange={handleSubjectChange} disabled={!sectionKey}>
                    <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>
                      {subjectOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Date</Label>
                  <Input
                    type="date"
                    value={date}
                    max={todayStr()}
                    onChange={(e) => { setDate(e.target.value); resetSession(); }}
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  onClick={() => void handleLoadStudents()}
                  disabled={!selectedAssignment || !date || isLoadingStudents}
                  loading={isLoadingStudents}
                >
                  <RefreshCw className="h-4 w-4" />
                  Submit
                </Button>
              </div>
            </CardContent>
          </Card>

          {isLoadingStudents && <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />}

          {!isLoadingStudents && loadError && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">{loadError}</CardContent>
            </Card>
          )}

          {!isLoadingStudents && attendanceSession && (
            <>
              <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>
                    Total Students: <strong>{attendanceSession.totalStudents}</strong>
                    <span className="mx-2 text-blue-300">|</span>
                    Present: <strong>{presentCount}</strong>
                    <span className="mx-2 text-blue-300">|</span>
                    Absent: <strong>{markedCount - presentCount}</strong>
                  </span>
                </div>
                {isReadOnly ? (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                    <Lock className="h-4 w-4" /> Submitted (Read-only)
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-medium text-blue-700">
                    <Pencil className="h-4 w-4" /> Not Submitted
                  </span>
                )}
              </div>

              {attendanceSession.totalStudents === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    No students found in this section yet. Once your HOD/College Office adds or imports
                    students for this section, come back and load again.
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  {!isReadOnly && (
                    <div className="flex flex-wrap items-center justify-end gap-6 border-b px-4 py-3">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox
                          checked={mode === "PRESENTEES"}
                          onCheckedChange={(c) => handleModeToggle("PRESENTEES", c === true)}
                          aria-label="Check presentees"
                        />
                        Check Presentees
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox
                          checked={mode === "ABSENTEES"}
                          onCheckedChange={(c) => handleModeToggle("ABSENTEES", c === true)}
                          aria-label="Check absentees"
                        />
                        Check Absentees
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox
                          checked={mode === "ALL_PRESENT"}
                          onCheckedChange={(c) => handleModeToggle("ALL_PRESENT", c === true)}
                          aria-label="Mark all present"
                        />
                        Mark All Present
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Checkbox
                          checked={mode === "ALL_ABSENT"}
                          onCheckedChange={(c) => handleModeToggle("ALL_ABSENT", c === true)}
                          aria-label="Mark all absent"
                        />
                        Mark All Absent
                      </label>
                    </div>
                  )}
                  {!isReadOnly && !mode && (
                    <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                      Pick one option above to mark the whole class — the roster checkboxes unlock once you do.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">S.No</th>
                          <th className="px-4 py-3">Reg No.</th>
                          <th className="px-4 py-3">Student Name</th>
                          <th className="px-4 py-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {attendanceSession.entries.map((entry, i) => {
                          const value = draft[entry.studentId] ?? null;
                          const meaning = checkedMeaningFor(mode);
                          return (
                            <tr key={entry.studentId}>
                              <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                              <td className="px-4 py-2.5">{entry.rollNumber}</td>
                              <td className="px-4 py-2.5 font-medium text-foreground">{entry.name}</td>
                              <td className="px-4 py-2.5 text-center">
                                <Checkbox
                                  checked={value === meaning}
                                  disabled={isReadOnly || !mode}
                                  onCheckedChange={(c) => handleRowCheck(entry.studentId, c === true)}
                                  aria-label={`Mark ${entry.name} ${meaning === "PRESENT" ? "present" : "absent"}`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {attendanceSession.totalStudents > 0 && (
                <Card>
                  <CardContent className="space-y-4 py-5">
                    <div className="space-y-2">
                      <Label htmlFor="classNotes">Class Description</Label>
                      <Textarea
                        id="classNotes"
                        placeholder="What did you cover in this class? (topics taught, activities, etc.)"
                        value={classNotes}
                        onChange={(e) => setClassNotes(e.target.value)}
                        disabled={isReadOnly}
                        rows={3}
                      />
                    </div>

                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        <p>
                          {isReadOnly
                            ? "This attendance has been submitted and is locked."
                            : "Please review the attendance before submitting."}
                        </p>
                        <p>Once submitted, attendance cannot be edited or modified.</p>
                      </div>
                      <p className="text-sm font-medium shrink-0">
                        You have marked {markedCount} out of {attendanceSession.totalStudents} students
                      </p>
                      {!isReadOnly && (
                        <Button
                          onClick={() => void handleSubmit()}
                          disabled={!allMarked || isSubmitting}
                          loading={isSubmitting}
                          className="shrink-0"
                        >
                          <Lock className="h-4 w-4" />
                          Submit Attendance
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
