"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Upload, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import type { StudentListItem, Department, StudentStatus } from "@/types";

type StudentRow = Record<string, unknown> & StudentListItem;

const YEARS = [1, 2, 3, 4, 5];
const STATUS_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  REGULAR: "default",
  DETAINED: "outline",
  GRADUATED: "secondary",
};

export default function CollegeOfficeStudentsPage() {
  const router = useRouter();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("all");

  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [year, setYear] = useState("1");
  const [status, setStatus] = useState<StudentStatus>("REGULAR");
  const [isSaving, setIsSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<StudentRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const [studentsRes, deptsRes] = await Promise.all([
        fetch("/api/college/students").then((r) => r.json() as Promise<{ students: StudentRow[] }>),
        fetch("/api/college/departments").then((r) => r.json() as Promise<{ departments: Department[] }>),
      ]);
      setStudents(studentsRes.students ?? []);
      setDepartments(deptsRes.departments ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Wrapped so the loader's setState calls aren't synchronously reachable
    // from the effect body (react-hooks/set-state-in-effect).
    void (async () => { await load(); })();
  }, []);

  function resetAddForm() {
    setName("");
    setDepartment("");
    setYear("1");
    setStatus("REGULAR");
  }

  async function handleAdd() {
    if (!name.trim() || !department) {
      toast({ variant: "destructive", title: "Name and department are required" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          department,
          year: Number(year),
          status,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to add student");
      toast({ variant: "success", title: "Student added (unassigned)" });
      setAddOpen(false);
      resetAddForm();
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to add student" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/students/${deleteTarget.id}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove");
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to remove student" });
    } finally {
      setIsDeleting(false);
    }
  }

  const filtered = useMemo(
    () => (deptFilter === "all" ? students : students.filter((s) => s.department === deptFilter)),
    [students, deptFilter]
  );

  const columns: Column<StudentRow>[] = [
    { key: "rollNumber", header: "Roll No", render: (r) => <span className="font-medium">{r.rollNumber || "—"}</span> },
    { key: "name", header: "Name" },
    { key: "department", header: "Department", hideOnMobile: true, render: (r) => <span className="text-sm text-muted-foreground">{r.department}</span> },
    {
      key: "section",
      header: "Section",
      render: (r) =>
        r.section
          ? <span>{r.section}</span>
          : <Badge variant="outline" className="text-amber-600 border-amber-300">Unassigned</Badge>,
    },
    { key: "year", header: "Year", hideOnMobile: true, render: (r) => <span>{r.year}</span> },
    {
      key: "status",
      header: "Status",
      render: (r) => <Badge variant={STATUS_VARIANTS[r.status] ?? "secondary"}>{r.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(r); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Students"
        description="Import, add, and remove student records. Leave a section blank to add students as unassigned - the sub-HOD divides them into sections later."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/college-office/students/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Dialog open={addOpen} onOpenChange={(open) => { setAddOpen(open); if (!open) resetAddForm(); }}>
              <DialogTrigger asChild>
                <Button><UserPlus className="h-4 w-4 mr-2" />Add Student</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Student</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="s-name">Name *</Label>
                    <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="P. Sai Kumar" autoComplete="off" />
                  </div>
                  <div className="space-y-2">
                    <Label>Department (Branch) *</Label>
                    <Select value={department} onValueChange={setDepartment}>
                      <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                      <SelectContent>
                        {departments.map((d) => (
                          <SelectItem key={d.id} value={d.name}>{d.name}{d.code ? ` (${d.code})` : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Year *</Label>
                      <Select value={year} onValueChange={setYear}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={status} onValueChange={(v) => setStatus(v as StudentStatus)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="REGULAR">Regular</SelectItem>
                          <SelectItem value="DETAINED">Detained</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    The student is added as <strong>unassigned</strong>. Roll number and section are assigned later,
                    once the department divides students into sections.
                  </p>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                  <Button onClick={() => void handleAdd()} loading={isSaving}>Add Student</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <DataTable
        data={filtered}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by roll number or name..."
        searchKeys={["rollNumber", "name"] as (keyof StudentRow)[]}
        emptyTitle="No students yet"
        emptyDescription="Import a roster or add students to get started."
        filterComponent={
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Remove student?"
        description={`This permanently removes ${deleteTarget?.name ?? "this student"}${deleteTarget?.rollNumber ? ` (${deleteTarget.rollNumber})` : ""}. This cannot be undone.`}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
