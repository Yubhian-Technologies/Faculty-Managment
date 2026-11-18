"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileText, Info, Lock, Pencil, RefreshCw, Upload } from "lucide-react";
import { istDateKey } from "@/lib/attendance/istTime";
import { downloadMidPaperFinalPdf } from "@/lib/pdf/downloadMidPaperSet";
import type { MidPaperFinal } from "@/types";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { ExamConfiguration, InternalExamMarksBatch, TeachingAssignment } from "@/types";
import { paperTotal, scaleToComponent, type QuestionSheet } from "@/lib/exams/questionMarks";
import type { MidEntryState } from "@/lib/exams/midMarksEntry";

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

/**
 * The internal marks entry screen. Faculty: their own assignments (Faculty > Internal Marks).
 * `onBehalf` (College Admin > Internal Marks > Enter on Behalf, lib/exams/onBehalf.ts): any department's sections -
 * the faculty member's own sheet, saved / submitted on their behalf.
 */
export function InternalMarksEntry({ onBehalf = false }: { onBehalf?: boolean } = {}) {
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
  // Components taken from a Mid question paper: their question columns, and studentId -> componentId -> key -> value.
  const [sheets, setSheets] = useState<Record<string, QuestionSheet>>({});
  // Mid-linked components: who enters them and whether this faculty can now (lib/exams/midMarksEntry.ts).
  const [midEntry, setMidEntry] = useState<Record<string, MidEntryState>>({});
  // Absent in a Mid (question-wise component): counts as 0, shown "AB".
  const [absentDraft, setAbsentDraft] = useState<Record<string, Record<string, boolean>>>({});
  const [viewing, setViewing] = useState("");
  /** The finalized paper (as printed by the Exam Cell, no answer key) - from the exam date on. */
  async function viewPaper(choiceId: string) {
    setViewing(choiceId);
    try {
      const res = await fetch(`/api/college/mid-paper-choices/final?choiceId=${encodeURIComponent(choiceId)}`);
      const json = (await res.json()) as { final?: MidPaperFinal; error?: string };
      if (!res.ok || !json.final) throw new Error(json.error ?? "Unable to load the question paper");
      const f = json.final;
      await downloadMidPaperFinalPdf(f, { fileName: `MID${f.exam.midNumber}_${f.exam.date}${f.sections.length ? `_${f.branchCode}` : ""}_${f.subject.code}` });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to load the question paper" }); }
    finally { setViewing(""); }
  }
  const [questionDraft, setQuestionDraft] = useState<Record<string, Record<string, Record<string, string>>>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // On behalf: departments first, then the picked department's assignments.
  const [departments, setDepartments] = useState<string[]>([]);
  useEffect(() => {
    if (!onBehalf) return;
    fetch("/api/college/internal-exam-marks/on-behalf")
      .then((r) => r.json() as Promise<{ departments?: string[]; error?: string }>)
      .then((d) => { setDepartments(d.departments ?? []); if (d.error) toast({ variant: "destructive", title: d.error }); })
      .catch(() => toast({ variant: "destructive", title: "Unable to load the departments." }))
      .finally(() => setIsLoadingAssignments(false));
  }, [onBehalf]);

  useEffect(() => {
    if (onBehalf) return;
    void (async () => {
      setIsLoadingAssignments(true);
      try {
        const res = await fetch("/api/college/teaching-assignments");
        if (!res.ok) throw new Error("Unable to load teaching assignments");
        const json = (await res.json()) as { assignments?: TeachingAssignment[] };
        setAssignments((json.assignments ?? []).filter((a) => !a.isPast));
      } catch {
        toast({ variant: "destructive", title: "Unable to load your teaching assignments" });
      } finally {
        setIsLoadingAssignments(false);
      }
    })();
  }, [onBehalf]);

  const branchOptions = useMemo(() => {
    if (onBehalf) return departments;
    const seen = new Set<string>();
    assignments.forEach((a) => a.department && seen.add(a.department));
    return [...seen].sort();
  }, [assignments, onBehalf, departments]);

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
        seen.set(a.subjectId, { value: a.subjectId, label: `${a.subjectName} (${a.subjectCode})${onBehalf && a.facultyName ? ` - ${a.facultyName}` : ""}` });
      });
    return [...seen.values()];
  }, [assignments, branch, sectionKey, onBehalf]);

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
    setSheets({});
    setQuestionDraft({});
  }

  function handleBranchChange(v: string) {
    if (onBehalf) {
      setAssignments([]);
      setIsLoadingAssignments(true);
      fetch(`/api/college/internal-exam-marks/on-behalf?department=${encodeURIComponent(v)}`)
        .then((r) => r.json() as Promise<{ assignments?: TeachingAssignment[] }>)
        .then((d) => setAssignments(d.assignments ?? []))
        .catch(() => toast({ variant: "destructive", title: "Unable to load the department's subjects." }))
        .finally(() => setIsLoadingAssignments(false));
    }
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
      const res = await fetch(onBehalf ? "/api/college/internal-exam-marks/on-behalf" : "/api/college/internal-exam-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: selectedAssignment.id }),
      });
      const json = (await res.json()) as { batch?: InternalExamMarksBatch; configuration?: ExamConfiguration; sheets?: Record<string, QuestionSheet>; midEntry?: Record<string, MidEntryState>; error?: string };
      if (!res.ok || !json.batch || !json.configuration) {
        setLoadError(json.error ?? "Unable to load students");
        return;
      }
      setBatch(json.batch);
      setConfiguration(json.configuration);
      const sh = json.sheets ?? {};
      setSheets(sh);
      setMidEntry(json.midEntry ?? {});
      setAbsentDraft(Object.fromEntries(json.batch.entries.map((e) => [e.studentId, { ...(e.absentIn ?? {}) }])));
      setQuestionDraft(Object.fromEntries(json.batch.entries.map((e) => [e.studentId, Object.fromEntries(Object.keys(sh).map((cid) => [cid,
        Object.fromEntries(sh[cid].columns.map((c) => { const v = e.questionMarks?.[cid]?.[c.key]; return [c.key, v == null ? "" : String(v)]; }))]))])));
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
      setLoadError("Unable to load students");
    } finally {
      setIsLoadingStudents(false);
    }
  }

  function handleMarkChange(studentId: string, componentId: string, value: string) {
    setMarksDraft((prev) => ({ ...prev, [studentId]: { ...prev[studentId], [componentId]: value } }));
  }

  function handleQuestionChange(studentId: string, componentId: string, key: string, value: string) {
    setQuestionDraft((prev) => ({ ...prev, [studentId]: { ...prev[studentId], [componentId]: { ...prev[studentId]?.[componentId], [key]: value } } }));
  }
  const numbers = (row: Record<string, string> | undefined) =>
    Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, v.trim() === "" ? null : Number(v)]));

  /** A Mid component this faculty can't type into now (the Exam Cell enters it, or its questions aren't set yet). */
  const isLocked = (componentId: string) => !!midEntry[componentId] && !midEntry[componentId].facultyCanEdit;

  /** A component's marks for a student: typed, or worked out from the paper's questions (scaled to its max). */
  function componentValue(studentId: string, componentId: string, max: number): number | null {
    // Not this faculty's to enter: what is saved (e.g. the Exam Cell's upload), read only.
    if (isLocked(componentId)) return batch?.entries.find((e) => e.studentId === studentId)?.componentMarks[componentId] ?? null;
    if (absentDraft[studentId]?.[componentId]) return 0;
    // R26 CEA: worked out by the server from the submitted CEA units (Faculty > CEA Marks) - read only here.
    if (activeComponents.find((c) => c.id === componentId)?.cea) return batch?.entries.find((e) => e.studentId === studentId)?.componentMarks[componentId] ?? null;
    const sheet = sheets[componentId];
    if (!sheet) { const raw = marksDraft[studentId]?.[componentId]; return raw?.trim() ? Number(raw) : null; }
    const total = paperTotal(sheet, numbers(questionDraft[studentId]?.[componentId]));
    return total == null ? null : scaleToComponent(total, sheet.paperMax, max);
  }

  function studentTotal(studentId: string): number {
    return activeComponents.reduce((sum, c) => sum + (componentValue(studentId, c.id, c.maxMarks) ?? 0), 0);
  }

  function isRowComplete(studentId: string): boolean {
    return activeComponents.length > 0 && activeComponents.every((c) => componentValue(studentId, c.id, c.maxMarks) != null);
  }

  const enteredCount = batch ? batch.entries.filter((e) => isRowComplete(e.studentId)).length : 0;
  const allEntered = !!batch && batch.totalStudents > 0 && enteredCount === batch.totalStudents;
  const isReadOnly = batch?.status === "SUBMITTED";

  const entriesToSend = () => (batch?.entries ?? []).map((e) => ({
    studentId: e.studentId,
    componentMarks: Object.fromEntries(
      activeComponents.filter((c) => !sheets[c.id] && !c.cea && !isLocked(c.id)).map((c) => {
        const raw = marksDraft[e.studentId]?.[c.id];
        return [c.id, raw?.trim() ? Number(raw) : null];
      })
    ),
    ...(Object.keys(sheets).some((cid) => !isLocked(cid))
      ? {
        questionMarks: Object.fromEntries(Object.keys(sheets).filter((cid) => !isLocked(cid) && !absentDraft[e.studentId]?.[cid]).map((cid) => [cid, numbers(questionDraft[e.studentId]?.[cid])])),
        absent: Object.fromEntries(Object.keys(sheets).filter((cid) => !isLocked(cid)).map((cid) => [cid, !!absentDraft[e.studentId]?.[cid]])),
      }
      : {}),
  }));

  // Excel for the faculty: the section's sheet with every column they may enter (a Mid's "Absent" + its questions,
  // and the other typed components). Uploading only fills this screen; Save / Submit and the server's checks follow.
  type ExcelCol = { head: string; comp: string; kind: "absent" | "q" | "total"; key?: string };
  const excelColumns = (): ExcelCol[] => activeComponents.filter((c) => !c.cea && !isLocked(c.id)).flatMap((c): ExcelCol[] => sheets[c.id]
    ? [{ head: `${c.name} - Absent`, comp: c.id, kind: "absent" }, ...sheets[c.id].columns.map((col): ExcelCol => ({ head: `${c.name} - ${col.label} (/${col.max})`, comp: c.id, kind: "q", key: col.key }))]
    : [{ head: `${c.name} (/${c.maxMarks})`, comp: c.id, kind: "total" }]);

  async function downloadExcel() {
    if (!batch || !selectedAssignment) return;
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Marks");
    const cols = excelColumns();
    ws.addRow(["Regd. No", "Name", ...cols.map((x) => x.head)]).font = { bold: true };
    for (const e of batch.entries) {
      ws.addRow([e.rollNumber, e.name, ...cols.map((x) =>
        x.kind === "absent" ? (absentDraft[e.studentId]?.[x.comp] ? "AB" : "")
          : x.kind === "q" ? (questionDraft[e.studentId]?.[x.comp]?.[x.key!] ?? "")
            : (marksDraft[e.studentId]?.[x.comp] ?? ""))]);
    }
    ws.columns = [{ width: 16 }, { width: 30 }, ...cols.map((x) => ({ width: Math.max(10, Math.min(x.head.length + 2, 24)) }))];
    ws.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];
    const blob = new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${selectedAssignment.subjectCode || "marks"}_${batch.sectionName}_internal-marks.xlsx`.replace(/[\\/:*?"<>|\s]+/g, "-");
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function uploadExcel(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f || !batch) return;
    try {
      if (!f.name.toLowerCase().endsWith(".xlsx")) throw new Error("Upload the .xlsx file you downloaded, filled in.");
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      const ws = wb.worksheets[0];
      const cell = (v: unknown) => String(v && typeof v === "object" && "result" in v ? (v as { result: unknown }).result : v ?? "").trim();
      const rows: string[][] = [];
      ws?.eachRow((row) => { rows.push((row.values as unknown[]).slice(1).map(cell)); });
      const head = rows[0] ?? [];
      if (!/^regd/i.test(head[0] ?? "")) throw new Error("The first column's heading must be \"Regd. No\" - download the sheet and fill that.");
      const cols = excelColumns();
      const at = cols.map((x) => head.indexOf(x.head));
      const byRoll = new Map(batch.entries.map((x) => [x.rollNumber.trim().toUpperCase(), x.studentId]));
      const q = structuredClone(questionDraft), m = structuredClone(marksDraft), ab = structuredClone(absentDraft);
      let filled = 0;
      const unknown: string[] = [];
      for (const r of rows.slice(1)) {
        const roll = (r[0] ?? "").toUpperCase();
        if (!roll) continue;
        const sid = byRoll.get(roll);
        if (!sid) { unknown.push(roll); continue; }
        cols.forEach((x, i) => {
          if (at[i] < 0) return;
          const v = r[at[i]] ?? "";
          if (x.kind === "absent") ab[sid] = { ...ab[sid], [x.comp]: /^(ab|a|y|yes|absent)$/i.test(v) };
          else if (x.kind === "q") q[sid] = { ...q[sid], [x.comp]: { ...q[sid]?.[x.comp], [x.key!]: v } };
          else m[sid] = { ...m[sid], [x.comp]: v };
        });
        filled++;
      }
      setQuestionDraft(q); setMarksDraft(m); setAbsentDraft(ab);
      toast({
        title: `Marks filled for ${filled} students from the file. Check them, then Save Draft or Submit.`,
        ...(unknown.length ? { description: `Not in this section: ${unknown.slice(0, 6).join(", ")}${unknown.length > 6 ? " …" : ""}` } : {}),
      });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to read the file." });
    }
  }

  /** Keep what is entered so far (nothing is submitted). */
  async function handleSaveDraft() {
    if (!batch) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/internal-exam-marks/${batch.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: entriesToSend() }),
      });
      const json = (await res.json()) as { batch?: InternalExamMarksBatch; error?: string };
      if (!res.ok || !json.batch) throw new Error(json.error ?? "Unable to save");
      setBatch(json.batch);
      toast({ variant: "success", title: "Marks saved as a draft" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to save" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSubmit() {
    if (!batch || !allEntered) return;
    setIsSubmitting(true);
    try {
      const entries = entriesToSend();
      const res = await fetch(`/api/college/internal-exam-marks/${batch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, submit: true }),
      });
      const json = (await res.json()) as { batch?: InternalExamMarksBatch; error?: string };
      if (!res.ok || !json.batch) throw new Error(json.error ?? "Unable to submit marks");
      setBatch(json.batch);
      toast({ variant: "success", title: "Marks submitted" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Unable to submit marks" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={onBehalf ? "Enter Marks on Behalf" : "Internal Marks"}
        description={onBehalf
          ? "For a section whose faculty hasn't entered the marks: open their sheet and enter, save or submit it for them. They are told when it's submitted."
          : "Select the details and assign marks to students. Once submitted, marks cannot be edited."}
      />

      {/* On behalf: the department picker comes first, so its pickers always show (assignments load per department). */}
      {!onBehalf && isLoadingAssignments ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !onBehalf && assignments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You have no teaching assignments yet. Ask your HOD to assign you to a section and subject
            before entering internal exam marks.
          </CardContent>
        </Card>
      ) : (
        <>
          {onBehalf && branch && !isLoadingAssignments && assignments.length === 0 && (
            <p className="text-sm text-muted-foreground">No sections with subjects in {branch} yet.</p>
          )}
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
                <>
                {activeComponents.some((c) => sheets[c.id]?.paper) && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    {activeComponents.filter((c) => sheets[c.id]?.paper).map((c) => {
                      const ref = sheets[c.id].paper!;
                      const open = ref.date <= istDateKey();
                      return (
                        <Button key={c.id} size="sm" variant="outline" disabled={!open || viewing === ref.choiceId} loading={viewing === ref.choiceId}
                          title={open ? "The paper as the Exam Cell printed it - marks are entered against it" : `Available from the exam date (${ref.date})`}
                          onClick={() => void viewPaper(ref.choiceId)}>
                          <FileText className="mr-1.5 h-4 w-4" />{c.name}: question paper{open ? "" : ` (from ${ref.date})`}
                        </Button>
                      );
                    })}
                  </div>
                )}
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">S.No</th>
                          <th className="px-4 py-3">Regd. No.</th>
                          <th className="px-4 py-3">Student Name</th>
                          {activeComponents.map((c) => sheets[c.id] ? (
                            <th key={c.id} className="px-2 py-3" colSpan={sheets[c.id].columns.length + 1}>
                              {c.name} (Max {c.maxMarks}) - {sheets[c.id].source === "LAYOUT" ? "questions set by the Exam Cell" : "from the question paper"} (out of {sheets[c.id].paperMax})
                              {isLocked(c.id) && <span className="block font-normal normal-case text-amber-700">{midEntry[c.id].note}</span>}
                              <div className="mt-1 flex gap-1 normal-case">
                                {sheets[c.id].columns.map((col) => <span key={col.key} className="w-14 text-center" title={`Max ${col.max}`}>{col.label}<br /><span className="font-normal">/{col.max}</span></span>)}
                                <span className="w-14 text-center">= /{c.maxMarks}</span>
                              </div>
                            </th>
                          ) : (
                            <th key={c.id} className="px-4 py-3">{c.name} (Max {c.maxMarks}){c.cea && <span className="block font-normal normal-case">from CIE Marks</span>}
                              {isLocked(c.id) && <span className="block max-w-[14rem] font-normal normal-case text-amber-700">{midEntry[c.id].note}</span>}</th>
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
                            {activeComponents.map((c) => sheets[c.id] ? (
                              <td key={c.id} className="px-2 py-2.5" colSpan={sheets[c.id].columns.length + 1}>
                                <div className="flex items-center gap-1">
                                  {!isLocked(c.id) && (
                                    <button type="button" disabled={isReadOnly}
                                      aria-pressed={!!absentDraft[entry.studentId]?.[c.id]} aria-label={`${entry.name} absent for ${c.name}`}
                                      title="Absent - counts as 0"
                                      onClick={() => setAbsentDraft((prev) => ({ ...prev, [entry.studentId]: { ...prev[entry.studentId], [c.id]: !prev[entry.studentId]?.[c.id] } }))}
                                      className={`h-8 w-9 rounded border text-xs font-semibold ${absentDraft[entry.studentId]?.[c.id] ? "border-destructive bg-destructive/10 text-destructive" : "text-muted-foreground hover:bg-muted"}`}>
                                      AB
                                    </button>
                                  )}
                                  {sheets[c.id].columns.map((col) => (
                                    <Input key={col.key} type="number" min={0} max={col.max} step={0.5} className="h-8 w-14 px-1.5 text-center" disabled={isReadOnly || isLocked(c.id) || !!absentDraft[entry.studentId]?.[c.id]}
                                      aria-label={`${col.label} marks for ${entry.name}`}
                                      value={questionDraft[entry.studentId]?.[c.id]?.[col.key] ?? ""}
                                      onChange={(e) => handleQuestionChange(entry.studentId, c.id, col.key, e.target.value)} />
                                  ))}
                                  <span className="w-14 text-center font-semibold">{(absentDraft[entry.studentId]?.[c.id] || entry.absentIn?.[c.id]) && isLocked(c.id) ? "AB" : absentDraft[entry.studentId]?.[c.id] ? "AB" : componentValue(entry.studentId, c.id, c.maxMarks) ?? "-"}</span>
                                </div>
                              </td>
                            ) : c.cea || isLocked(c.id) ? (
                              <td key={c.id} className="px-4 py-2.5 font-medium" title={c.cea ? "Calculated from the submitted CIE units." : midEntry[c.id]?.note}>{entry.absentIn?.[c.id] ? "AB" : componentValue(entry.studentId, c.id, c.maxMarks) ?? "-"}</td>
                            ) : (
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
                </>
              )}

              {batch.totalStudents > 0 && (
                <Card>
                  <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm text-muted-foreground">
                      <p>
                        {isReadOnly
                          ? "These marks have been submitted and are locked."
                          : "Review the marks before submitting."}
                      </p>
                      <p>Once submitted, marks cannot be edited or modified.</p>
                    </div>
                    <p className="text-sm font-medium shrink-0">
                      You have entered marks for {enteredCount} out of {batch.totalStudents} students
                    </p>
                    {!isReadOnly && (
                      <div className="flex shrink-0 gap-2">
                        <Button variant="ghost" size="sm" onClick={() => void downloadExcel()}><Download className="mr-1 h-4 w-4" />Excel</Button>
                        <Button asChild variant="ghost" size="sm">
                          <label className="cursor-pointer"><Upload className="mr-1 h-4 w-4" />Upload<input type="file" accept=".xlsx" className="hidden" onChange={(e) => void uploadExcel(e)} /></label>
                        </Button>
                      </div>
                    )}
                    {!isReadOnly && (
                      <Button variant="outline" onClick={() => void handleSaveDraft()} loading={isSaving} disabled={isSubmitting} className="shrink-0">Save Draft</Button>
                    )}
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
