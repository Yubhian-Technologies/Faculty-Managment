"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { AlertTriangle, CheckCircle2, Pencil, Trash2, X, XCircle } from "lucide-react";
import type { Department } from "@/types";
import { offeredYears } from "@/lib/college/departmentYears";
import { courseYearNumbers, semesterLabel } from "@/lib/college/courseYears";
import { useCourseSemesterPlan } from "@/hooks/useCourseSemesterPlan";
import { managedCoreCandidates } from "@/lib/departments/departmentTree";
import { ASSIGN_MAX_CODES } from "@/lib/subjects/limits";
import type { AssignByCodeResult, AssignCodeResult } from "@/lib/subjects/services/SubjectAssignService";

type CourseOption = { id: string; name: string; catalogId?: string; departmentId?: string; isActive?: boolean; durationYears?: number };
type SlotRow = { id: string; subjectId: string; subjectCode: string; subjectName: string; serialNumber?: number; category?: string; credits?: number; lectureHours?: number; tutorialHours?: number; practicalHours?: number; departmentId: string; semester: number; secondaryDepartmentNames?: string[]; isNonTeachingLoad?: boolean };

const SELECT_CLASS = "h-9 w-full rounded-md border bg-background px-2 text-sm";

const STATUS_STYLE: Record<AssignCodeResult["status"], { label: string; className: string }> = {
  ASSIGN: { label: "Will be assigned", className: "text-green-700 dark:text-green-400" },
  ALREADY_ASSIGNED: { label: "Already here", className: "text-muted-foreground" },
  NOT_FOUND: { label: "Not found", className: "text-red-600" },
  INACTIVE: { label: "Deactivated", className: "text-red-600" },
  AMBIGUOUS: { label: "Duplicate code", className: "text-red-600" },
};

// Curriculum > Assign: the only way a subject reaches a department's semester. Pick the Department,
// Year and Semester, type or paste Subject Codes, check them, assign. The scope bar above supplies the
// Regulation and the Course; the checks run on the server (SubjectAssignService) and a single bad code
// means nothing is assigned.
export function AssignByCodeStep({ catalogId, regulation, courseName, initialDepartmentId }: { catalogId: string; regulation: string; courseName: string; initialDepartmentId?: string }) {
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loadError, setLoadError] = useState("");
  const [deptId, setDeptId] = useState("");
  const [subDeptId, setSubDeptId] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [codesText, setCodesText] = useState("");

  const [check, setCheck] = useState<{ result: AssignByCodeResult; forKey: string } | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const [slot, setSlot] = useState<SlotRow[]>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [removing, setRemoving] = useState<SlotRow | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ row: SlotRow; l: string; t: string; p: string; credits: string } | null>(null);
  const [editError, setEditError] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [showTarget, setShowTarget] = useState(false);
  const [targetIds, setTargetIds] = useState<Set<string>>(new Set());
  const [targeting, setTargeting] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const [c, d] = await Promise.all([
          fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: CourseOption[] }>),
          fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments?: Department[] }>),
        ]);
        setCourses((c.courses ?? []).filter((x) => x.isActive !== false));
        setDepartments(d.departments ?? []);
      } catch {
        setLoadError("Couldn't load courses or departments.");
      }
    })();
  }, []);

  // A deep link (Principal > Department > semester chip) arrives with a department; a sub-department
  // is shown as its parent plus the sub-department pick.
  useEffect(() => {
    if (!initialDepartmentId || departments.length === 0) return;
    const d = departments.find((x) => x.id === initialDepartmentId);
    if (!d) return;
    if (d.parentDepartmentId) { setDeptId(d.parentDepartmentId); setSubDeptId(d.id); }
    else { setDeptId(d.id); setSubDeptId(""); }
  }, [initialDepartmentId, departments]);

  // Only departments that actually run this catalog course - own a Course doc for it,
  // or (a parent standing in for a shared-first-year sub-department) have one that does.
  // Was previously every top-level department in the college regardless of `catalogId`.
  const topDepartments = useMemo(() => {
    const ownerIds = new Set(courses.filter((c) => c.catalogId === catalogId).map((c) => c.departmentId));
    return departments
      .filter((d) => !d.parentDepartmentId)
      .filter((d) => ownerIds.has(d.id) || departments.some((sub) => sub.parentDepartmentId === d.id && ownerIds.has(sub.id)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [departments, courses, catalogId]);
  const subDepartments = useMemo(() => departments.filter((d) => d.parentDepartmentId === deptId), [departments, deptId]);
  const activeDeptId = subDeptId || deptId;
  const activeDept = useMemo(() => departments.find((d) => d.id === activeDeptId), [departments, activeDeptId]);

  // The department's own Course doc for this catalog course decides the years and semesters. A
  // sub-department created by an HOD carries no Course doc of its own (only its parent does, e.g.
  // "Artificial Intelligence" owns the Bachelor of Technology doc that "CSE [AI&DS]"/"CSE [AI&ML]"
  // inherit) - fall back to the PARENT's copy specifically, never to "any course sharing this
  // catalogId", since a college can have several departments each running their own independent copy
  // of the same catalog course (e.g. every branch at VWU owns its own Bachelor of Technology doc) -
  // grabbing an arbitrary one would send the wrong courseId to the server, which then correctly
  // refuses it as "not run by" this department.
  const planCourse = useMemo(() => {
    const candidateIds = activeDept?.parentDepartmentId
      ? [activeDeptId, activeDept.parentDepartmentId]
      : [activeDeptId];
    for (const id of candidateIds) {
      const found = courses.find((c) => c.catalogId === catalogId && c.departmentId === id);
      if (found) return found;
    }
    return null;
  }, [courses, catalogId, activeDeptId, activeDept]);
  const plan = useCourseSemesterPlan(planCourse);
  const yearOptions = useMemo(
    () => offeredYears(activeDept, departments, catalogId, courseYearNumbers(planCourse?.durationYears)),
    [activeDept, departments, catalogId, planCourse],
  );
  const yearValue = yearOptions.includes(Number(year)) ? year : "";
  // Only what the course's own Semester Timings configure for this year - never an invented 1-2.
  const semesterOptions = useMemo(
    () => (yearValue && plan.source === "timings" ? plan.semesters.filter((sem) => plan.yearOf(sem) === Number(yearValue)) : []),
    [plan, yearValue],
  );
  const semesterValue = semesterOptions.includes(Number(semester)) ? semester : "";
  // The CORE departments a feeder sub-department (e.g. Basic Science - Chemistry) actually teaches. A subject
  // assigned to the feeder covers all of them unless narrowed to specific ones below.
  const coreDepartments = useMemo(() => {
    if (!activeDept) return [];
    return managedCoreCandidates(departments, activeDept, false)
      .map((n) => departments.find((d) => d.name === n))
      .filter((d): d is Department => !!d);
  }, [departments, activeDept]);
  const ready = !!activeDeptId && !!planCourse && !!yearValue && !!semesterValue && !!regulation;
  const scopeKey = `${catalogId}|${regulation}|${activeDeptId}|${yearValue}|${semesterValue}`;
  const checkKey = `${scopeKey}|${codesText.trim()}`;

  const loadSlot = useCallback(async () => {
    if (!ready || !planCourse) { setSlot([]); return; }
    setSlotLoading(true);
    try {
      const res = await fetch(`/api/college/subject-semester-assignments?courseId=${encodeURIComponent(planCourse.id)}&departmentId=${encodeURIComponent(activeDeptId)}&year=${yearValue}&semester=${semesterValue}`);
      const body = (await res.json()) as { assignments?: (SlotRow & { regulation?: string; isActive?: boolean })[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load");
      setSelected(new Set());
      setSlot((body.assignments ?? [])
        .filter((a) => a.isActive !== false && a.departmentId === activeDeptId && (!a.regulation || a.regulation === regulation))
        .sort((a, b) => (a.serialNumber ?? Infinity) - (b.serialNumber ?? Infinity) || a.subjectCode.localeCompare(b.subjectCode)));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to load this semester's subjects" });
    } finally {
      setSlotLoading(false);
    }
  }, [ready, planCourse, activeDeptId, yearValue, semesterValue, regulation]);

  useEffect(() => { void loadSlot(); }, [loadSlot]);
  useEffect(() => { setCheck(null); setError(""); }, [scopeKey]);

  async function post(mode: "validate" | "commit") {
    const res = await fetch("/api/college/subject-semester-assignments/assign-by-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode, courseId: planCourse!.id, departmentId: activeDeptId, regulation,
        year: Number(yearValue), semester: Number(semesterValue), codesText,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Partial<AssignByCodeResult> & { error?: string };
    return { res, json };
  }

  async function runCheck() {
    if (!ready) return;
    setChecking(true);
    setError("");
    try {
      const { res, json } = await post("validate");
      if (json.plan) setCheck({ result: json as AssignByCodeResult, forKey: checkKey });
      else { setCheck(null); setError(json.error ?? "Couldn't check the codes."); }
      if (!res.ok && !json.plan) return;
    } catch {
      setError("Network error while checking the codes.");
    } finally {
      setChecking(false);
    }
  }

  async function runAssign() {
    if (!ready || !check || check.forKey !== checkKey || !check.result.ok) return;
    setAssigning(true);
    setError("");
    try {
      const { json } = await post("commit");
      if (json.plan && json.ok) {
        const n = json.counts?.toAssign ?? 0;
        toast({ variant: "success", title: n > 0 ? `${n} subject${n !== 1 ? "s" : ""} assigned` : "Nothing new to assign" });
        setCodesText("");
        setCheck(null);
        await loadSlot();
      } else if (json.plan) {
        setCheck({ result: json as AssignByCodeResult, forKey: checkKey });
        setError("Nothing was assigned. Fix the codes marked below and check again.");
      } else {
        setError(json.error ?? "Couldn't assign the subjects. Nothing was saved.");
      }
    } catch {
      setError("Network error. Nothing was saved.");
    } finally {
      setAssigning(false);
    }
  }

  async function unassign() {
    const row = removing;
    if (!row) return;
    try {
      const res = await fetch(`/api/college/subject-semester-assignments?subjectId=${encodeURIComponent(row.subjectId)}&departmentId=${encodeURIComponent(row.departmentId)}&semester=${row.semester}`, { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Couldn't unassign" }); return; }
      toast({ variant: "success", title: `${row.subjectCode} removed from this semester` });
      await loadSlot();
    } finally {
      setRemoving(null);
    }
  }

  async function patchRow(body: Record<string, unknown>) {
    const res = await fetch("/api/college/subject-semester-assignments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "Failed to update");
  }

  async function saveEdit() {
    if (!editing) return;
    setSavingEdit(true);
    setEditError("");
    try {
      await patchRow({ id: editing.row.id, lectureHours: editing.l, tutorialHours: editing.t, practicalHours: editing.p, credits: editing.credits });
      toast({ variant: "success", title: `${editing.row.subjectCode} updated for this department` });
      setEditing(null);
      await loadSlot();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  }

  // Narrow the ticked subjects from "covers every core department this sub-department manages" to the ticked ones
  // (or back to all). Timetables and existing faculty assignments are never touched.
  async function retarget(clear: boolean) {
    const rows = slot.filter((r) => selected.has(r.id));
    const names = clear ? null : Array.from(targetIds).map((id) => departments.find((d) => d.id === id)?.name).filter((n): n is string => !!n);
    if (rows.length === 0 || (!clear && (!names || names.length === 0))) return;
    setTargeting(true);
    const results = await Promise.allSettled(rows.map((r) => patchRow({ id: r.id, secondaryDepartmentNames: names })));
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    setTargeting(false);
    setShowTarget(false);
    setTargetIds(new Set());
    toast({
      variant: failed.length > 0 ? "default" : "success",
      title: failed.length > 0 ? `${rows.length - failed.length} updated, ${failed.length} failed` : clear ? `${rows.length} subject(s) back to covering every department` : `${rows.length} subject(s) now target ${names!.join(", ")} only`,
      description: failed[0]?.reason?.message,
    });
    await loadSlot();
  }

  async function dropTarget(row: SlotRow, name: string) {
    const next = (row.secondaryDepartmentNames ?? []).filter((n) => n !== name);
    try {
      await patchRow({ id: row.id, secondaryDepartmentNames: next.length > 0 ? next : null });
      await loadSlot();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove" });
    }
  }

  const fresh = !!check && check.forKey === checkKey;
  const canAssign = fresh && check!.result.ok && check!.result.counts.toAssign > 0 && !assigning;

  return (
    <div className="space-y-4">
      {loadError && <p className="text-sm text-red-600">{loadError}</p>}

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <select className={SELECT_CLASS} value={deptId} onChange={(e) => { setDeptId(e.target.value); setSubDeptId(""); }}>
                <option value="">Select department</option>
                {topDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            {subDepartments.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs">Sub-department</Label>
                <select className={SELECT_CLASS} value={subDeptId} onChange={(e) => setSubDeptId(e.target.value)}>
                  <option value="">The department itself</option>
                  {subDepartments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">Year</Label>
              <select className={SELECT_CLASS} value={yearValue} disabled={!activeDeptId} onChange={(e) => setYear(e.target.value)}>
                <option value="">{activeDeptId ? "Select year" : "Pick a department first"}</option>
                {yearOptions.map((y) => <option key={y} value={y}>Year {y}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Semester</Label>
              <select className={SELECT_CLASS} value={semesterValue} disabled={!yearValue} onChange={(e) => setSemester(e.target.value)}>
                <option value="">{yearValue ? "Select semester" : "Pick a year first"}</option>
                {semesterOptions.map((s) => <option key={s} value={s}>{semesterLabel(plan, s)} (Sem {s})</option>)}
              </select>
            </div>
          </div>
          {!!activeDeptId && !!yearValue && semesterOptions.length === 0 && (
            <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Year {yearValue} has no semesters configured in Course-Year Timings, so nothing can be assigned yet.
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Subject codes</Label>
            <Textarea
              rows={6}
              value={codesText}
              disabled={!ready}
              onChange={(e) => setCodesText(e.target.value)}
              placeholder={ready ? "CS201\nCS202\nCS203" : "Choose the department, year and semester first"}
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {courseName} · {regulation}. One code per line, or separated by commas or spaces - up to {ASSIGN_MAX_CODES}. They appear in the order you type them.
              Codes come from the course&apos;s subject list (Subjects tab); nothing is imported here.
            </p>
          </div>

          {error && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-destructive/20 dark:bg-destructive/10 dark:text-red-400">{error}</p>}

          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void runCheck()} loading={checking} disabled={!ready || !codesText.trim() || assigning}>Check codes</Button>
            <Button onClick={() => void runAssign()} loading={assigning} disabled={!canAssign}>
              {fresh && check!.result.counts.toAssign > 0 ? `Assign ${check!.result.counts.toAssign} subject${check!.result.counts.toAssign !== 1 ? "s" : ""}` : "Assign"}
            </Button>
            {check && !fresh && <span className="text-xs text-muted-foreground">The codes or scope changed - check again.</span>}
          </div>

          {check && (
            <div className="rounded-lg border">
              {check.result.warnings.map((w) => (
                <p key={w} className="flex items-start gap-1.5 border-b bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</p>
              ))}
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr><th className="p-2">Code</th><th className="p-2">Subject</th><th className="p-2">Result</th></tr>
                </thead>
                <tbody className="divide-y">
                  {check.result.plan.map((p) => (
                    <tr key={p.code}>
                      <td className="p-2 font-mono">{p.code}</td>
                      <td className="p-2">{p.name ?? "-"}</td>
                      <td className={`p-2 ${STATUS_STYLE[p.status].className}`}>
                        <span className="inline-flex items-start gap-1">
                          {p.status === "ASSIGN" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : p.status === "ALREADY_ASSIGNED" ? null : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                          {STATUS_STYLE[p.status].label}{p.message && p.status !== "ASSIGN" ? ` - ${p.message}` : ""}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {check.result.counts.repeatedInList > 0 && (
                <p className="border-t p-2 text-xs text-muted-foreground">{check.result.counts.repeatedInList} repeated code{check.result.counts.repeatedInList !== 1 ? "s" : ""} in the list ignored.</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {ready && (
        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">
              {activeDept?.name} · Year {yearValue} · {semesterLabel(plan, Number(semesterValue))} - {slotLoading ? "…" : `${slot.length} subject${slot.length !== 1 ? "s" : ""}`}
            </h3>
            {coreDepartments.length > 0 && slot.length > 0 && (
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={selected.size === 0} onClick={() => { setTargetIds(new Set()); setShowTarget(true); }}>Target core departments ({selected.size})</Button>
                <span className="text-xs text-muted-foreground">Tick subjects to narrow them to specific core departments.</span>
              </div>
            )}
            {!slotLoading && slot.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No subjects assigned to this semester yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>{coreDepartments.length > 0 && <th className="py-1.5 pr-2 w-6" />}<th className="py-1.5 pr-3">#</th><th className="py-1.5 pr-3">Code</th><th className="py-1.5 pr-3">Subject</th><th className="py-1.5 pr-3">L-T-P</th><th className="py-1.5 pr-3">Credits</th><th className="py-1.5" /></tr>
                  </thead>
                  <tbody className="divide-y">
                    {slot.map((r, i) => (
                      <tr key={r.id}>
                        {coreDepartments.length > 0 && (
                          <td className="py-1.5 pr-2">
                            <Checkbox
                              aria-label={`Select ${r.subjectCode}`}
                              checked={selected.has(r.id)}
                              onCheckedChange={(v) => setSelected((prev) => { const n = new Set(prev); if (v === true) n.add(r.id); else n.delete(r.id); return n; })}
                            />
                          </td>
                        )}
                        <td className="py-1.5 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="py-1.5 pr-3 font-mono">{r.subjectCode}</td>
                        <td className="py-1.5 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium">{r.subjectName}</span>
                            {r.isNonTeachingLoad && <span className="rounded border border-purple-200 bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold text-purple-800 dark:border-purple-800 dark:bg-purple-950/70 dark:text-purple-300">Not in teaching load</span>}
                            {(r.secondaryDepartmentNames ?? []).length > 0 && <span className="text-[10px] text-muted-foreground">Targets:</span>}
                            {(r.secondaryDepartmentNames ?? []).map((name) => (
                              <span key={name} className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-800 dark:border-blue-800 dark:bg-blue-950/70 dark:text-blue-300">
                                {name}
                                <button type="button" aria-label={`Stop targeting ${name}`} onClick={() => void dropTarget(r, name)}><X className="h-3 w-3" /></button>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums">{r.lectureHours ?? 0}-{r.tutorialHours ?? 0}-{r.practicalHours ?? 0}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{r.credits ?? 0}</td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${r.subjectCode} for this department`} onClick={() => { setEditError(""); setEditing({ row: r, l: String(r.lectureHours ?? 0), t: String(r.tutorialHours ?? 0), p: String(r.practicalHours ?? 0), credits: String(r.credits ?? 0) }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" aria-label={`Remove ${r.subjectCode}`} onClick={() => setRemoving(r)}><Trash2 className="h-3.5 w-3.5" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.row.subjectCode} - this department&apos;s hours and credits</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">Applies to {activeDept?.name} in this semester only. To change the subject itself (name, category, course-wide hours), use the Subjects tab.</p>
              <div className="grid grid-cols-4 gap-3">
                {([["L", "l"], ["T", "t"], ["P", "p"], ["Credits", "credits"]] as const).map(([label, key]) => (
                  <div key={key} className="space-y-1"><Label>{label}</Label><Input inputMode="decimal" value={editing[key]} onChange={(e) => setEditing({ ...editing, [key]: e.target.value })} /></div>
                ))}
              </div>
              {editError && <p className="rounded-md border border-red-200 bg-red-50 p-2 text-sm text-red-700 dark:border-destructive/20 dark:bg-destructive/10 dark:text-red-400">{editError}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={() => void saveEdit()} loading={savingEdit}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTarget} onOpenChange={setShowTarget}>
        <DialogContent>
          <DialogHeader><DialogTitle>Target core departments</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Pick which of {activeDept?.name}&apos;s core departments the {selected.size} selected subject(s) apply to - other sections won&apos;t see them in Teaching Assignments going forward.
              Existing faculty assignments and timetables are never affected.
            </p>
            {coreDepartments.map((d) => (
              <label key={d.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={targetIds.has(d.id)} onCheckedChange={(v) => setTargetIds((prev) => { const n = new Set(prev); if (v === true) n.add(d.id); else n.delete(d.id); return n; })} />
                {d.name}
              </label>
            ))}
          </div>
          <DialogFooter className="sm:justify-between">
            <Button variant="ghost" className="text-xs text-muted-foreground" onClick={() => void retarget(true)} disabled={targeting}>Clear narrowing (cover every department again)</Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowTarget(false)}>Cancel</Button>
              <Button onClick={() => void retarget(false)} disabled={targetIds.size === 0 || targeting} loading={targeting}>Apply</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remove from this semester?"
        description={`${removing?.subjectCode} - ${removing?.subjectName} will be taken out of this department's semester. The subject itself stays in the course's list. This is refused while a faculty member is assigned to teach it.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void unassign()}
      />
    </div>
  );
}
