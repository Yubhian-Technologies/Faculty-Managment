"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { stripLeadingZeros } from "@/lib/utils";
import { SUBJECT_TYPE_LABELS } from "@/types";
import type { Subject, SubjectType, TeachingAssignment, FMSUser, Section } from "@/types";

export default function TeachingAssignmentsPage() {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [faculty, setFaculty] = useState<FMSUser[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [subjectForm, setSubjectForm] = useState({ name: "", code: "", semester: "1", hoursPerWeek: "3", credits: "3", type: "THEORY" as SubjectType });
  const [savingSubject, setSavingSubject] = useState(false);

  const [assignForm, setAssignForm] = useState({ facultyId: "", subjectId: "", academicYear: "", semester: "1", section: "" });
  const [savingAssignment, setSavingAssignment] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/subjects").then((r) => r.json() as Promise<{ subjects: Subject[] }>).then((d) => setSubjects(d.subjects ?? [])),
      fetch("/api/college/users?role=PANEL_MEMBER").then((r) => r.json() as Promise<{ users: FMSUser[] }>).then((d) => setFaculty(d.users ?? [])),
      fetch("/api/college/sections").then((r) => r.json() as Promise<{ sections: Section[] }>).then((d) => setSections(d.sections ?? [])),
      fetch("/api/college/teaching-assignments?dept=true").then((r) => r.json() as Promise<{ assignments: TeachingAssignment[] }>).then((d) => setAssignments(d.assignments ?? [])),
    ])
      .catch(() => toast({ variant: "destructive", title: "Failed to load teaching data" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreateSubject(e: React.FormEvent) {
    e.preventDefault();
    if (!subjectForm.name.trim() || !subjectForm.code.trim()) return;
    setSavingSubject(true);
    try {
      const res = await fetch("/api/college/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...subjectForm,
          semester: Number(subjectForm.semester),
          hoursPerWeek: Number(subjectForm.hoursPerWeek),
          credits: Number(subjectForm.credits),
        }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Subject created" });
      setSubjectForm({ name: "", code: "", semester: "1", hoursPerWeek: "3", credits: "3", type: "THEORY" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to create subject" });
    } finally {
      setSavingSubject(false);
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!assignForm.facultyId || !assignForm.subjectId || !assignForm.academicYear.trim()) return;
    setSavingAssignment(true);
    try {
      const res = await fetch("/api/college/teaching-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...assignForm, semester: Number(assignForm.semester) }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Failed to assign", description: json.error });
        return;
      }
      toast({ variant: "success", title: "Faculty assigned" });
      setAssignForm({ facultyId: "", subjectId: "", academicYear: assignForm.academicYear, semester: assignForm.semester, section: "" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSavingAssignment(false);
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

  return (
    <div className="space-y-6">
      <PageHeader title="Teaching Assignments" description="Create subjects and assign faculty to sections" />

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Add Subject</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreateSubject} className="space-y-3">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input value={subjectForm.name} onChange={(e) => setSubjectForm((f) => ({ ...f, name: e.target.value }))} placeholder="Data Structures" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Code</Label>
                  <Input value={subjectForm.code} onChange={(e) => setSubjectForm((f) => ({ ...f, code: e.target.value }))} placeholder="CS201" />
                </div>
                <div className="space-y-2">
                  <Label>Semester</Label>
                  <Input type="number" min={1} max={8} value={subjectForm.semester} onChange={(e) => setSubjectForm((f) => ({ ...f, semester: stripLeadingZeros(e.target.value) }))} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label>Hours/Week</Label>
                  <Input type="number" min={0} value={subjectForm.hoursPerWeek} onChange={(e) => setSubjectForm((f) => ({ ...f, hoursPerWeek: stripLeadingZeros(e.target.value) }))} />
                </div>
                <div className="space-y-2">
                  <Label>Credits</Label>
                  <Input type="number" min={0} value={subjectForm.credits} onChange={(e) => setSubjectForm((f) => ({ ...f, credits: stripLeadingZeros(e.target.value) }))} />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={subjectForm.type} onValueChange={(v) => setSubjectForm((f) => ({ ...f, type: v as SubjectType }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(SUBJECT_TYPE_LABELS) as SubjectType[]).map((t) => (
                        <SelectItem key={t} value={t}>{SUBJECT_TYPE_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button type="submit" loading={savingSubject} disabled={!subjectForm.name.trim() || !subjectForm.code.trim()}>
                <Plus className="h-4 w-4 mr-1.5" /> Add Subject
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Assign Faculty</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleAssign} className="space-y-3">
              <div className="space-y-2">
                <Label>Subject</Label>
                <Select value={assignForm.subjectId} onValueChange={(v) => setAssignForm((f) => ({ ...f, subjectId: v }))}>
                  <SelectTrigger><SelectValue placeholder={subjects.length ? "Select subject" : "Add a subject first"} /></SelectTrigger>
                  <SelectContent>
                    {subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Faculty</Label>
                <Select value={assignForm.facultyId} onValueChange={(v) => setAssignForm((f) => ({ ...f, facultyId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select faculty" /></SelectTrigger>
                  <SelectContent>
                    {faculty.map((f) => <SelectItem key={f.uid} value={f.uid}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Academic Year</Label>
                  <Input value={assignForm.academicYear} onChange={(e) => setAssignForm((f) => ({ ...f, academicYear: e.target.value }))} placeholder="2025-26" />
                </div>
                <div className="space-y-2">
                  <Label>Semester</Label>
                  <Input type="number" min={1} max={8} value={assignForm.semester} onChange={(e) => setAssignForm((f) => ({ ...f, semester: stripLeadingZeros(e.target.value) }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Section</Label>
                <Select value={assignForm.section} onValueChange={(v) => setAssignForm((f) => ({ ...f, section: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select section (optional)" /></SelectTrigger>
                  <SelectContent>
                    {sections.map((s) => <SelectItem key={s.id} value={s.name}>{s.name} (Year {s.year})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="submit"
                loading={savingAssignment}
                disabled={!assignForm.facultyId || !assignForm.subjectId || !assignForm.academicYear.trim()}
              >
                Assign
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Current Assignments</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}</div>
          ) : assignments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No teaching assignments yet.</p>
          ) : (
            <div className="divide-y">
              {assignments.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">{a.subjectName} <span className="text-muted-foreground">({a.subjectCode})</span></p>
                    <p className="text-xs text-muted-foreground">
                      {a.facultyName} · {a.academicYear} · Sem {a.semester}{a.section ? ` · Sec ${a.section}` : ""} · {a.hoursPerWeek} hrs/wk
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">{a.department}</Badge>
                    <Button size="sm" variant="ghost" onClick={() => void handleRemove(a.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
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
