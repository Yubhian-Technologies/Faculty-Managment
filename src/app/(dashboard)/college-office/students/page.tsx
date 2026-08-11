"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, Upload, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { StudentListItem, Department, AcademicYear } from "@/types";

// Fields collected here mirror the Excel/CSV import (Name, Department, Academic
// Year + optional Gender, Date of Birth, Guardian Contact, Email) so a student
// added manually carries exactly the same information as an imported one. Roll
// number and section are deliberately NOT collected - like the import, every
// manual add is "unassigned"; the department (sub-)HOD sections the student and
// assigns a roll number later.
type AddForm = {
  name: string;
  department: string;
  year: string;
  gender: string;
  dateOfBirth: string;
  guardianContact: string;
  email: string;
};

const EMPTY_FORM: AddForm = {
  name: "", department: "", year: "", gender: "",
  dateOfBirth: "", guardianContact: "", email: "",
};

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function OfficeStudentsPage() {
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState<string>("all");

  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<AddForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<StudentListItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [studentsRes, deptsRes, yearsRes] = await Promise.all([
        fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentListItem[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
        fetch("/api/college/academic-years").then((r) => r.json() as Promise<{ academicYears?: AcademicYear[] }>).catch(() => ({ academicYears: [] })),
      ]);
      const loaded = studentsRes.students ?? [];
      setStudents(loaded);
      setDepartments(deptsRes.departments ?? []);
      // Prefer the college's configured academic years; fall back to whatever
      // years already appear on students, then to a sensible 1-4 default so the
      // dropdowns are never empty for a freshly set-up college.
      const configured = (yearsRes.academicYears ?? []).map((y) => y.yearNumber).filter(Boolean);
      const fromStudents = Array.from(new Set(loaded.map((s) => s.year).filter(Boolean)));
      const merged = Array.from(new Set([...configured, ...fromStudents])).sort((a, b) => a - b);
      setYears(merged.length > 0 ? merged : [1, 2, 3, 4]);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Wrapped so the loader's setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.isActive).sort((a, b) => a.name.localeCompare(b.name)),
    [departments]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      if (deptFilter !== "all" && s.department !== deptFilter) return false;
      if (yearFilter !== "all" && s.year !== Number(yearFilter)) return false;
      if (q && !(
        s.name.toLowerCase().includes(q)
        || (s.rollNumber ?? "").toLowerCase().includes(q)
        || (s.email ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [students, search, deptFilter, yearFilter]);

  function setF(patch: Partial<AddForm>) { setForm((f) => ({ ...f, ...patch })); }

  function openAdd() {
    setForm(EMPTY_FORM);
    setAddOpen(true);
  }

  async function handleAdd() {
    if (!form.name.trim()) { toast({ variant: "destructive", title: "Name is required" }); return; }
    if (!form.department) { toast({ variant: "destructive", title: "Department is required" }); return; }
    if (!form.year) { toast({ variant: "destructive", title: "Academic Year is required" }); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/college/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          department: form.department,
          year: Number(form.year),
          gender: form.gender || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          guardianContact: form.guardianContact || undefined,
          email: form.email || undefined,
        }),
      });
      const json = await res.json() as { id?: string; error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Failed to add student" }); return; }
      toast({ variant: "success", title: `${form.name.trim()} added` });
      setAddOpen(false);
      setForm(EMPTY_FORM);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error - please try again" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/students/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) { toast({ variant: "destructive", title: json.error ?? "Failed to remove" }); return; }
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Add, view and remove students - or bulk-import a roster"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/college-office/students/import"><Upload className="h-4 w-4 mr-2" />Import</Link>
            </Button>
            <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Student</Button>
          </div>
        }
      />

      {/* Summary */}
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span><strong className="text-foreground">{students.length}</strong> students total</span>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, roll number or email"
            className="pl-9"
          />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All departments" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {activeDepartments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={yearFilter} onValueChange={setYearFilter}>
          <SelectTrigger className="sm:w-40"><SelectValue placeholder="All years" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All years</SelectItem>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Users className="h-10 w-10 text-muted-foreground mb-3" />
          <p className="font-medium">{students.length === 0 ? "No students yet" : "No students match your filters"}</p>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            {students.length === 0 ? "Add a student manually or import a roster to get started." : "Try clearing the search or filters."}
          </p>
          {students.length === 0 && <Button onClick={openAdd}><Plus className="h-4 w-4 mr-2" />Add Student</Button>}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium whitespace-nowrap">Department</th>
                    <th className="p-3 font-medium whitespace-nowrap">Year</th>
                    <th className="p-3 font-medium whitespace-nowrap">Section</th>
                    <th className="p-3 font-medium whitespace-nowrap">Roll No.</th>
                    <th className="p-3 font-medium whitespace-nowrap">Gender</th>
                    <th className="p-3 font-medium whitespace-nowrap">Date of Birth</th>
                    <th className="p-3 font-medium whitespace-nowrap">Guardian Contact</th>
                    <th className="p-3 font-medium whitespace-nowrap">Email</th>
                    <th className="p-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((s, i) => (
                    <tr key={s.id} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="p-3 font-medium whitespace-nowrap">{s.name}</td>
                      <td className="p-3 whitespace-nowrap">{s.department}</td>
                      <td className="p-3 whitespace-nowrap">{ordinalYear(s.year)}</td>
                      <td className="p-3 whitespace-nowrap">
                        {s.section
                          ? <Badge variant="secondary" className="text-xs">{s.section}</Badge>
                          : <span className="text-muted-foreground italic text-xs">Unassigned</span>}
                      </td>
                      <td className="p-3 whitespace-nowrap">{s.rollNumber || <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="p-3 whitespace-nowrap">{s.gender || <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="p-3 whitespace-nowrap">{s.dateOfBirth || <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="p-3 whitespace-nowrap">{s.guardianContact || <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="p-3 whitespace-nowrap">{s.email || <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => setDeleteTarget(s)}
                          className="p-1.5 rounded-md hover:bg-red-100 text-red-600 transition-colors"
                          title="Remove student"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Add Student dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Student</DialogTitle>
            <DialogDescription>
              Same details as the roster import. The student is added as unassigned - the
              department assigns their section and roll number later.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stu-name">Name *</Label>
              <Input id="stu-name" value={form.name} onChange={(e) => setF({ name: e.target.value })} placeholder="P. Sai Kumar" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Department *</Label>
                <Select value={form.department} onValueChange={(v) => setF({ department: v })}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {activeDepartments.map((d) => <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Academic Year *</Label>
                <Select value={form.year} onValueChange={(v) => setF({ year: v })}>
                  <SelectTrigger><SelectValue placeholder="Select year" /></SelectTrigger>
                  <SelectContent>
                    {years.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Gender</Label>
                <Select value={form.gender || "__none__"} onValueChange={(v) => setF({ gender: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not specified</SelectItem>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="stu-dob">Date of Birth</Label>
                <Input id="stu-dob" type="date" value={form.dateOfBirth} onChange={(e) => setF({ dateOfBirth: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="stu-guardian">Guardian Contact</Label>
                <Input id="stu-guardian" value={form.guardianContact} onChange={(e) => setF({ guardianContact: e.target.value })} placeholder="9876543210" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="stu-email">Email</Label>
                <Input id="stu-email" type="email" value={form.email} onChange={(e) => setF({ email: e.target.value })} placeholder="student@example.com" />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => void handleAdd()} loading={saving}>Add Student</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title={`Remove ${deleteTarget?.name ?? ""}?`}
        description={`This will permanently remove ${deleteTarget?.name ?? "this student"}${deleteTarget?.department ? ` (${deleteTarget.department}, ${ordinalYear(deleteTarget.year)})` : ""}. This cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
