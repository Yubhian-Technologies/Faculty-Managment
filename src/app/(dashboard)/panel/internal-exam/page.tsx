"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Lock, Pencil, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { ExamConfiguration, InternalExamMarksBatch, TeachingAssignment } from "@/types";

interface Option {
  value: string;
  label: string;
}

// Teaching assignments come in two shapes (see TeachingAssignment): course/
// section-scoped ones carry a real sectionId; semester-scoped ones (HOD's
// "Teaching Assignments" page) only carry a free-text section name — this key
// groups either shape into one selectable "class" for the Section dropdown.
function sectionKeyOf(a: TeachingAssignment): string {
  return a.sectionId ?? `sem:${a.department}:${a.section ?? ""}:${a.academicYear ?? ""}:${a.semester ?? ""}`;
}

function sectionLabelOf(a: TeachingAssignment): string {
  if (a.sectionId) return `${a.sectionName ?? "Section"} — Year ${a.year ?? "?"}`;
  const term = [a.academicYear, a.semester ? `Sem ${a.semester}` : ""].filter(Boolean).join(" · ");
  return `${a.section?.trim() || "Section"}${term ? ` — ${term}` : ""}`;
}

export default function InternalExamPage() {
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoadingAssignments, setIsLoadingAssignments] = useState(true);

  const [branch, setBranch] = useState("");
  const [sectionKey, setSectionKey] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const [batch, setBatch] = useState<InternalExamMarksBatch | null>(null);
  const [configuration, setConfiguration] = useState<ExamConfiguration | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  // studentId -> componentId -> entered value (string, for controlled inputs)
  const [marksDraft, setMarksDraft] = useState<Record<string, Record<string, string>>>({});
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

  const branchOptions = useMemo(() => {
    const seen = new Set<string>();
    assignments.forEach((a) => a.department && seen.add(a.department));
    return [...seen].sort();
  }, [assignments]);

  const sectionOptions = useMemo<Option[]>(() => {
    const seen = new Map<string, Option>();
    assignments
      .filter((a) => a.department === branch)
      .forEach((a) => {
        const key = sectionKeyOf(a);
        if (!seen.has(key)) seen.set(key, { value: key, label: sectionLabelOf(a) });
      });
    return [...seen.values()];
  }, [assignments, branch]);

  const subjectOptions = useMemo<Option[]>(() => {
    const seen = new Map<string, Option>();
    assignments
      .filter((a) => a.department === branch && sectionKeyOf(a) === sectionKey)
      .forEach((a) => {
        seen.set(a.subjectId, { value: a.subjectId, label: `${a.subjectName} (${a.subjectCode})` });
      });
    return [...seen.values()];
  }, [assignments, branch, sectionKey]);

  // The exact assignment the current Branch+Section+Subject selection maps
  // to — its own id is what the API keys the marks batch off (both shapes
  // resolve to a single teachingAssignments doc once the subject is picked).
  const selectedAssignment = useMemo(
    () =>
      assignments.find(
        (a) => a.department === branch && sectionKeyOf(a) === sectionKey && a.subjectId === subjectId
      ) ?? null,
    [assignments, branch, sectionKey, subjectId]
  );

  function resetBatch() {
    setBatch(null);
    setConfiguration(null);
    setLoadError(null);
    setMarksDraft({});
  }

  function handleBranchChange(v: string) {
    setBranch(v);
    setSectionKey("");
    setSubjectId("");
    resetBatch();
  }

  function handleSectionChange(v: string) {
    setSectionKey(v);
    setSubjectId("");
    resetBatch();
  }

  const activeComponents = useMemo(
    () => (configuration ? [...configuration.components].filter((c) => c.isActive).sort((a, b) => a.order - b.order) : []),
    [configuration]
  );

  async function handleLoadStudents() {
    if (!selectedAssignment) return;
    setIsLoadingStudents(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/college/internal-exam-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: selectedAssignment.id }),
      });
      const json = (await res.json()) as { batch?: InternalExamMarksBatch; configuration?: ExamConfiguration; error?: string };
      if (!res.ok || !json.batch || !json.configuration) {
        setLoadError(json.error ?? "Failed to load students");
        return;
      }
      setBatch(json.batch);
      setConfiguration(json.configuration);
      const activeIds = json.configuration.components.filter((c) => c.isActive).map((c) => c.id);
      setMarksDraft(
        Object.fromEntries(
          json.batch.entries.map((e) => [
            e.studentId,
            Object.fromEntries(activeIds.map((cid) => [cid, e.componentMarks[cid] == null ? "" : String(e.componentMarks[cid])])),
          ])
        )
      );
    } catch {
      setLoadError("Failed to load students");
    } finally {
      setIsLoadingStudents(false);
    }
  }

  function handleMarkChange(studentId: string, componentId: string, value: string) {
    setMarksDraft((prev) => ({ ...prev, [studentId]: { ...prev[studentId], [componentId]: value } }));
  }

  function studentTotal(studentId: string): number {
    const row = marksDraft[studentId] ?? {};
    return activeComponents.reduce((sum, c) => sum + (Number(row[c.id]) || 0), 0);
  }

  function isRowComplete(studentId: string): boolean {
    const row = marksDraft[studentId] ?? {};
    return activeComponents.length > 0 && activeComponents.every((c) => row[c.id]?.trim());
  }

  const enteredCount = batch ? batch.entries.filter((e) => isRowComplete(e.studentId)).length : 0;
  const allEntered = !!batch && batch.totalStudents > 0 && enteredCount === batch.totalStudents;
  const isReadOnly = batch?.status === "SUBMITTED";

  async function handleSubmit() {
    if (!batch || !allEntered) return;
    setIsSubmitting(true);
    try {
      const entries = batch.entries.map((e) => ({
        studentId: e.studentId,
        componentMarks: Object.fromEntries(
          activeComponents.map((c) => {
            const raw = marksDraft[e.studentId]?.[c.id];
            return [c.id, raw?.trim() ? Number(raw) : null];
          })
        ),
      }));
      const res = await fetch(`/api/college/internal-exam-marks/${batch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, submit: true }),
      });
      const json = (await res.json()) as { batch?: InternalExamMarksBatch; error?: string };
      if (!res.ok || !json.batch) throw new Error(json.error ?? "Failed to submit marks");
      setBatch(json.batch);
      toast({ variant: "success", title: "Marks submitted successfully" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit marks" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internal Exam"
        description="Select the details and assign marks to students. Once submitted, marks cannot be edited."
      />

      {isLoadingAssignments ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You have no teaching assignments yet. Ask your HOD to assign you to a section and subject
            before entering internal exam marks.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:items-end">
                <div className="space-y-2">
                  <Label>Branch</Label>
                  <Select value={branch} onValueChange={handleBranchChange}>
                    <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                    <SelectContent>
                      {branchOptions.map((b) => (
                        <SelectItem key={b} value={b}>{b}</SelectItem>
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
                  <Select
                    value={subjectId}
                    onValueChange={(v) => { setSubjectId(v); resetBatch(); }}
                    disabled={!sectionKey}
                  >
                    <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                    <SelectContent>
                      {subjectOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <Button
                  onClick={() => void handleLoadStudents()}
                  disabled={!selectedAssignment || isLoadingStudents}
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

          {!isLoadingStudents && batch && configuration && (
            <>
              <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>
                    Total Students: <strong>{batch.totalStudents}</strong>
                    <span className="mx-2 text-blue-300">|</span>
                    Internal Max: <strong>{configuration.internalMaxMarks}</strong>
                    <span className="mx-2 text-blue-300">|</span>
                    External Max: <strong>{configuration.externalMaxMarks}</strong>
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

              {batch.totalStudents === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    No students found in this section yet. Once your HOD/College Office adds or imports
                    students for this section, come back and load again.
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">S.No</th>
                          <th className="px-4 py-3">Roll No.</th>
                          <th className="px-4 py-3">Student Name</th>
                          {activeComponents.map((c) => (
                            <th key={c.id} className="px-4 py-3">{c.name} (Max {c.maxMarks})</th>
                          ))}
                          <th className="px-4 py-3">Total (Out of {configuration.internalMaxMarks})</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {batch.entries.map((entry, i) => (
                          <tr key={entry.studentId}>
                            <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                            <td className="px-4 py-2.5">{entry.rollNumber}</td>
                            <td className="px-4 py-2.5 font-medium text-foreground">{entry.name}</td>
                            {activeComponents.map((c) => (
                              <td key={c.id} className="px-4 py-2.5">
                                <Input
                                  type="number"
                                  min={0}
                                  max={c.maxMarks}
                                  value={marksDraft[entry.studentId]?.[c.id] ?? ""}
                                  onChange={(e) => handleMarkChange(entry.studentId, c.id, e.target.value)}
                                  disabled={isReadOnly}
                                  className="w-20"
                                  aria-label={`${c.name} marks for ${entry.name}`}
                                />
                              </td>
                            ))}
                            <td className="px-4 py-2.5 font-semibold text-foreground">{studentTotal(entry.studentId)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {batch.totalStudents > 0 && (
                <Card>
                  <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      <p>
                        {isReadOnly
                          ? "These marks have been submitted and are locked."
                          : "Please review the marks before submitting."}
                      </p>
                      <p>Once submitted, marks cannot be edited or modified.</p>
                    </div>
                    <p className="text-sm font-medium shrink-0">
                      You have entered marks for {enteredCount} out of {batch.totalStudents} students
                    </p>
                    {!isReadOnly && (
                      <Button
                        onClick={() => void handleSubmit()}
                        disabled={!allEntered || isSubmitting}
                        loading={isSubmitting}
                        className="shrink-0"
                      >
                        <Lock className="h-4 w-4" />
                        Submit Marks
                      </Button>
                    )}
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
