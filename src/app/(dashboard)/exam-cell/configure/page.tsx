"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Save, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { Course, Department, ExamConfiguration, Subject } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

interface ComponentForm {
  id: string;
  name: string;
  maxMarks: string;
  description: string;
  isActive: boolean;
}

function emptyComponent(): ComponentForm {
  return { id: `new_${Math.random().toString(36).slice(2)}`, name: "", maxMarks: "", description: "", isActive: true };
}

function ExamCellConfigureForm() {
  const searchParams = useSearchParams();
  const preselectedSubjectId = searchParams.get("subjectId");

  const [courses, setCourses] = useState<Course[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(true);

  const [courseName, setCourseName] = useState("");
  const [year, setYear] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [subjectId, setSubjectId] = useState("");

  const [internalMaxMarks, setInternalMaxMarks] = useState("");
  const [externalMaxMarks, setExternalMaxMarks] = useState("");
  const [components, setComponents] = useState<ComponentForm[]>([emptyComponent()]);
  const [existingConfig, setExistingConfig] = useState<ExamConfiguration | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoadingData(true);
      try {
        const [courseRes, deptRes, subjectRes] = await Promise.all([
          fetch("/api/college/courses"),
          fetch("/api/college/departments"),
          fetch("/api/college/subjects"),
        ]);
        const courseJson = (await courseRes.json()) as { courses?: Course[] };
        const deptJson = (await deptRes.json()) as { departments?: Department[] };
        const subjectJson = (await subjectRes.json()) as { subjects?: Subject[] };
        const loadedCourses = courseJson.courses ?? [];
        // Only course/year-scoped subjects are reachable from this cascading
        // selector — the semester-scoped shape (no courseId) belongs to a
        // different flow (HOD's Teaching Assignments page).
        const loadedSubjects = (subjectJson.subjects ?? []).filter((s) => s.courseId && s.year != null);
        setCourses(loadedCourses);
        setDepartments(deptJson.departments ?? []);
        setSubjects(loadedSubjects);

        // Pre-select everything from ?subjectId= (the dashboard's "Edit" links),
        // now that this same load has the data needed to resolve it.
        if (preselectedSubjectId) {
          const subj = loadedSubjects.find((s) => s.id === preselectedSubjectId);
          const course = subj?.courseId ? loadedCourses.find((c) => c.id === subj.courseId) : null;
          if (subj && subj.year != null && course) {
            setCourseName(course.name);
            setYear(String(subj.year));
            setDepartmentId(course.departmentId);
            setSubjectId(subj.id);
          }
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load academic data" });
      } finally {
        setIsLoadingData(false);
      }
    })();
    // Intentionally mount-only — preselectedSubjectId is read from the URL once;
    // re-running this whole fetch if it changed would be unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departmentNameById = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments]);

  const courseNameOptions = useMemo(() => [...new Set(courses.map((c) => c.name))].sort(), [courses]);

  const yearOptions = useMemo(() => {
    const duration = Math.max(0, ...courses.filter((c) => c.name === courseName).map((c) => c.durationYears));
    return Array.from({ length: duration }, (_, i) => i + 1);
  }, [courses, courseName]);

  const branchOptions = useMemo(() => {
    const seen = new Map<string, string>();
    courses
      .filter((c) => c.name === courseName)
      .forEach((c) => seen.set(c.departmentId, departmentNameById.get(c.departmentId) ?? c.departmentId));
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [courses, courseName, departmentNameById]);

  const resolvedCourse = useMemo(
    () => courses.find((c) => c.name === courseName && c.departmentId === departmentId) ?? null,
    [courses, courseName, departmentId]
  );

  const subjectOptions = useMemo(() => {
    if (!resolvedCourse || !year) return [];
    return subjects.filter((s) => s.courseId === resolvedCourse.id && s.year === Number(year));
  }, [subjects, resolvedCourse, year]);

  const selectedSubject = subjectOptions.find((s) => s.id === subjectId) ?? null;

  function resetConfigFields() {
    setExistingConfig(null);
    setInternalMaxMarks("");
    setExternalMaxMarks("");
    setComponents([emptyComponent()]);
  }

  function resetDownstream(from: "course" | "year" | "branch") {
    if (from === "course") { setYear(""); setDepartmentId(""); setSubjectId(""); resetConfigFields(); }
    if (from === "year") { setDepartmentId(""); setSubjectId(""); resetConfigFields(); }
    if (from === "branch") { setSubjectId(""); resetConfigFields(); }
  }

  function handleSubjectChange(v: string) {
    setSubjectId(v);
    resetConfigFields();
  }

  // Load the configuration whenever the subject selection changes to a real subject.
  useEffect(() => {
    if (!subjectId) return;
    void (async () => {
      setIsLoadingConfig(true);
      try {
        const res = await fetch(`/api/college/exam-configurations?subjectId=${subjectId}`);
        const json = (await res.json()) as { configuration?: ExamConfiguration | null };
        if (json.configuration) {
          const cfg = json.configuration;
          setExistingConfig(cfg);
          setInternalMaxMarks(String(cfg.internalMaxMarks));
          setExternalMaxMarks(String(cfg.externalMaxMarks));
          setComponents(
            [...cfg.components]
              .sort((a, b) => a.order - b.order)
              .map((c) => ({ id: c.id, name: c.name, maxMarks: String(c.maxMarks), description: c.description ?? "", isActive: c.isActive }))
          );
        } else {
          setExistingConfig(null);
          setInternalMaxMarks("");
          setExternalMaxMarks("");
          setComponents([emptyComponent()]);
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load configuration" });
      } finally {
        setIsLoadingConfig(false);
      }
    })();
  }, [subjectId]);

  function updateComponent(id: string, patch: Partial<ComponentForm>) {
    setComponents((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function addComponent() {
    setComponents((list) => [...list, emptyComponent()]);
  }
  function removeComponent(id: string) {
    setComponents((list) => (list.length > 1 ? list.filter((c) => c.id !== id) : list));
  }

  const breakdownTotal = components
    .filter((c) => c.isActive)
    .reduce((sum, c) => sum + (Number(c.maxMarks) || 0), 0);
  const internalMax = Number(internalMaxMarks) || 0;
  const hasNamedComponent = components.some((c) => c.name.trim());
  const breakdownMatches = hasNamedComponent && internalMax > 0 && breakdownTotal === internalMax;

  async function handleSave() {
    if (!resolvedCourse || !selectedSubject || !year) return;
    const cleanComponents = components.filter((c) => c.name.trim());
    if (cleanComponents.length === 0) {
      toast({ variant: "destructive", title: "Add at least one internal marks component" });
      return;
    }
    if (!breakdownMatches) {
      toast({
        variant: "destructive",
        title: `Breakdown total must equal the Internal Maximum Marks (${internalMax}). Current total: ${breakdownTotal}.`,
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/college/exam-configurations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseId: resolvedCourse.id,
          courseName: resolvedCourse.name,
          department: departmentNameById.get(departmentId) ?? "",
          year: Number(year),
          subjectId: selectedSubject.id,
          subjectName: selectedSubject.name,
          subjectCode: selectedSubject.code,
          internalMaxMarks: internalMax,
          externalMaxMarks: Number(externalMaxMarks) || 0,
          components: cleanComponents.map((c, i) => ({
            id: c.id.startsWith("new_") ? undefined : c.id,
            name: c.name.trim(),
            maxMarks: Number(c.maxMarks) || 0,
            description: c.description.trim() || undefined,
            order: i,
            isActive: c.isActive,
          })),
        }),
      });
      const json = (await res.json()) as { configuration?: ExamConfiguration; error?: string };
      if (!res.ok || !json.configuration) throw new Error(json.error ?? "Failed to save configuration");
      setExistingConfig(json.configuration);
      toast({ variant: "success", title: "Examination configuration saved" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save configuration" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configure Examination"
        description="Select a course, year, branch and subject, then set its Internal/External marks and breakdown."
      />

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Course</Label>
              <Select value={courseName} onValueChange={(v) => { setCourseName(v); resetDownstream("course"); }} disabled={isLoadingData}>
                <SelectTrigger><SelectValue placeholder={isLoadingData ? "Loading…" : "Select course"} /></SelectTrigger>
                <SelectContent>
                  {courseNameOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Year</Label>
              <Select value={year} onValueChange={(v) => { setYear(v); resetDownstream("year"); }} disabled={!courseName}>
                <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Branch</Label>
              <Select value={departmentId} onValueChange={(v) => { setDepartmentId(v); resetDownstream("branch"); }} disabled={!year}>
                <SelectTrigger><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {branchOptions.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No branches offer this course</div>
                  )}
                  {branchOptions.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Subject</Label>
              <Select value={subjectId} onValueChange={handleSubjectChange} disabled={!departmentId}>
                <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
                <SelectContent>
                  {subjectOptions.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">No subjects found for this course/year</div>
                  )}
                  {subjectOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {subjectId && (
        isLoadingConfig ? (
          <div className="h-72 rounded-lg border bg-muted/30 animate-pulse" />
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Examination Configuration — {selectedSubject?.name}
                  {existingConfig && (
                    <span className="ml-2 text-xs font-normal text-muted-foreground">(editing existing configuration)</span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Internal Maximum Marks</Label>
                  <Input type="number" min={0} value={internalMaxMarks} onChange={(e) => setInternalMaxMarks(e.target.value)} placeholder="e.g. 30" />
                </div>
                <div className="space-y-2">
                  <Label>External Maximum Marks</Label>
                  <Input type="number" min={0} value={externalMaxMarks} onChange={(e) => setExternalMaxMarks(e.target.value)} placeholder="e.g. 70" />
                </div>
                {(internalMax > 0 || Number(externalMaxMarks) > 0) && (
                  <p className="sm:col-span-2 text-xs text-muted-foreground">
                    Overall Maximum Marks: <strong className="text-foreground">{internalMax + (Number(externalMaxMarks) || 0)}</strong>
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Internal Marks Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {components.map((c) => (
                    <div key={c.id} className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center">
                      <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                        <Input
                          value={c.name}
                          onChange={(e) => updateComponent(c.id, { name: e.target.value })}
                          placeholder="Component name (e.g. Quizzes)"
                        />
                        <Input
                          type="number"
                          min={0}
                          value={c.maxMarks}
                          onChange={(e) => updateComponent(c.id, { maxMarks: e.target.value })}
                          placeholder="Maximum marks"
                        />
                        <Input
                          value={c.description}
                          onChange={(e) => updateComponent(c.id, { description: e.target.value })}
                          placeholder="Description (optional)"
                        />
                      </div>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Checkbox checked={c.isActive} onCheckedChange={(v) => updateComponent(c.id, { isActive: v === true })} />
                          Active
                        </label>
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeComponent(c.id)} disabled={components.length === 1}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={addComponent}>
                  <Plus className="h-3.5 w-3.5" /> Add Component
                </Button>

                <div
                  className={`mt-4 flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                    breakdownMatches ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <span>Breakdown Total (active components)</span>
                  <span className="font-semibold">{breakdownTotal} / {internalMax || "—"}</span>
                </div>
                {!breakdownMatches && internalMax > 0 && hasNamedComponent && (
                  <p className="mt-2 text-xs text-destructive">
                    Breakdown total must equal the Internal Maximum Marks ({internalMax}). Current total: {breakdownTotal}.
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button onClick={() => void handleSave()} loading={saving} disabled={!breakdownMatches || saving}>
                <Save className="h-4 w-4" /> Save Configuration
              </Button>
            </div>
          </>
        )
      )}
    </div>
  );
}

export default function ExamCellConfigurePage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />}>
      <ExamCellConfigureForm />
    </Suspense>
  );
}
