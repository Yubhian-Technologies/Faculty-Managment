"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Save } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { ExamType, StudentRecord, TeachingAssignment } from "@/types";
import { EXAM_TYPE_LABELS } from "@/types";

type StudentRow = Record<string, unknown> & StudentRecord;

// Each exam type has exactly two fixed assessments — no free text either way.
const ASSESSMENT_NAMES: Record<ExamType, string[]> = {
  THEORY: ["Mid 1", "Mid 2"],
  LAB: ["Internal", "External"],
};

export default function InternalMarksPage() {
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);

  const [assignmentId, setAssignmentId] = useState("");
  const [examType, setExamType] = useState<ExamType>("THEORY");
  const [assessmentName, setAssessmentName] = useState(ASSESSMENT_NAMES.THEORY[0]);
  const [maxMarks, setMaxMarks] = useState("20");

  function handleExamTypeChange(next: ExamType) {
    setExamType(next);
    setAssessmentName(ASSESSMENT_NAMES[next][0]);
  }

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [marksMap, setMarksMap] = useState<Record<string, string>>({});
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/college/teaching-assignments")
      .then((r) => r.json() as Promise<{ assignments: TeachingAssignment[] }>)
      .then((d) => setAssignments((d.assignments ?? []).filter((a) => !!a.sectionId)))
      .catch(() => toast({ variant: "destructive", title: "Failed to load your teaching assignments" }))
      .finally(() => setIsLoadingAssignments(false));
  }, []);

  const selectedAssignment = assignments.find((a) => a.id === assignmentId);
  const currentKey = selectedAssignment ? `${selectedAssignment.sectionId}_${selectedAssignment.subjectId}_${examType}_${assessmentName}` : null;
  const isDirtyFromLoad = currentKey !== loadedKey;
  const maxMarksNum = Number(maxMarks);

  async function handleLoadRoster() {
    if (!selectedAssignment) return;
    const trimmedAssessment = assessmentName.trim();
    if (!trimmedAssessment || !maxMarksNum || maxMarksNum <= 0) {
      toast({ variant: "destructive", title: "Enter an assessment name and a positive max marks" });
      return;
    }
    setIsLoadingRoster(true);
    try {
      const params = new URLSearchParams({
        sectionId: selectedAssignment.sectionId!,
        subjectId: selectedAssignment.subjectId,
        examType,
        assessmentName: trimmedAssessment,
      });
      const res = await fetch(`/api/college/internal-marks?${params.toString()}`);
      const json = await res.json() as { students?: StudentRecord[]; marks?: { studentId: string; marksObtained: number }[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load roster");

      const roster = (json.students ?? []) as StudentRow[];
      const existingByStudent = new Map((json.marks ?? []).map((m) => [m.studentId, m.marksObtained]));
      setStudents(roster);
      setMarksMap(Object.fromEntries(roster.map((s) => [s.id, String(existingByStudent.get(s.id) ?? "")])));
      setLoadedKey(`${selectedAssignment.sectionId}_${selectedAssignment.subjectId}_${examType}_${trimmedAssessment}`);
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to load roster", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsLoadingRoster(false);
    }
  }

  async function handleSave() {
    if (!selectedAssignment || students.length === 0) return;
    const entries = students.map((s) => ({
      studentId: s.id,
      studentName: s.name,
      rollNumber: s.rollNumber,
      marksObtained: Number(marksMap[s.id] || 0),
    }));
    const invalid = entries.find((e) => Number.isNaN(e.marksObtained) || e.marksObtained < 0 || e.marksObtained > maxMarksNum);
    if (invalid) {
      toast({ variant: "destructive", title: `Marks for ${invalid.studentName} must be between 0 and ${maxMarksNum}` });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/college/internal-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId: selectedAssignment.sectionId,
          subjectId: selectedAssignment.subjectId,
          examType,
          assessmentName: assessmentName.trim(),
          maxMarks: maxMarksNum,
          entries,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to save marks");
      toast({ variant: "success", title: "Marks saved" });
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to save marks", description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  const columns: Column<StudentRow>[] = useMemo(() => [
    { key: "rollNumber", header: "Roll No" },
    { key: "name", header: "Name" },
    {
      key: "marks",
      header: `Marks (out of ${maxMarksNum || 0})`,
      render: (row) => (
        <Input
          type="number"
          min={0}
          max={maxMarksNum || undefined}
          value={marksMap[row.id] ?? ""}
          onChange={(e) => setMarksMap((m) => ({ ...m, [row.id]: e.target.value }))}
          className="h-9 w-24"
        />
      ),
    },
  ], [marksMap, maxMarksNum]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internal Marks"
        description="Enter internal assessment marks for the subjects you teach"
      />

      {!isLoadingAssignments && assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You have no section-based teaching assignments yet. Ask your HOD to assign you to a subject and section.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Select Class & Assessment</CardTitle></CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-5 sm:items-end">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Subject / Section</Label>
                  <Select value={assignmentId} onValueChange={setAssignmentId}>
                    <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                    <SelectContent>
                      {assignments.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.subjectName} — {a.sectionName}{a.courseName ? ` (${a.courseName})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Exam Type</Label>
                  <Select value={examType} onValueChange={(v) => handleExamTypeChange(v as ExamType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(EXAM_TYPE_LABELS) as ExamType[]).map((t) => (
                        <SelectItem key={t} value={t}>{EXAM_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Assessment</Label>
                  <Select value={assessmentName} onValueChange={setAssessmentName}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ASSESSMENT_NAMES[examType].map((name) => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Max Marks</Label>
                  <Input type="number" min={1} value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} />
                </div>
              </div>
              <Button className="mt-4" onClick={handleLoadRoster} loading={isLoadingRoster} disabled={!assignmentId}>
                <ClipboardList className="h-4 w-4 mr-1.5" /> Load Students
              </Button>
            </CardContent>
          </Card>

          {students.length > 0 && (
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  {selectedAssignment?.subjectName} — {selectedAssignment?.sectionName} · {EXAM_TYPE_LABELS[examType]} · {assessmentName}
                </CardTitle>
                <Button onClick={handleSave} loading={saving} disabled={isDirtyFromLoad}>
                  <Save className="h-4 w-4 mr-1.5" /> Save Marks
                </Button>
              </CardHeader>
              <CardContent>
                {isDirtyFromLoad && (
                  <p className="text-xs text-amber-600 mb-3">
                    Assessment name or max marks changed — click &quot;Load Students&quot; again before saving.
                  </p>
                )}
                <DataTable
                  data={students}
                  columns={columns}
                  keyExtractor={(r) => r.id}
                  searchPlaceholder="Search students..."
                  searchKeys={["name", "rollNumber"]}
                  emptyTitle="No students in this section"
                />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
