"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import {
  DESIGNATION_LABELS,
  EMPLOYMENT_TYPE_LABELS,
  FACULTY_STATUS_LABELS,
} from "@/types";
import type { FacultyMember, Designation, EmploymentType, FacultyStatus } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

export default function HODFacultyPage() {
  const router = useRouter();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [editMember, setEditMember] = useState<FacultyRow | null>(null);
  const [editForm, setEditForm] = useState({
    designation: "" as Designation,
    qualification: "",
    specialization: "",
    experienceYears: 0,
    employmentType: "" as EmploymentType,
    status: "" as FacultyStatus,
    phone: "",
  });
  const [editSaving, setEditSaving] = useState(false);

  async function load(status: string) {
    setIsLoading(true);
    try {
      const url = `/api/college/faculty${status ? `?status=${status}` : ""}`;
      const res = await fetch(url);
      const data = await res.json() as { faculty: FacultyRow[] };
      setFaculty(data.faculty ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load faculty" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(statusFilter); }, [statusFilter]);

  function openEdit(member: FacultyRow) {
    setEditMember(member);
    setEditForm({
      designation: member.designation as Designation,
      qualification: member.qualification as string,
      specialization: (member.specialization as string) ?? "",
      experienceYears: member.experienceYears as number,
      employmentType: member.employmentType as EmploymentType,
      status: member.status as FacultyStatus,
      phone: (member.phone as string) ?? "",
    });
  }

  async function handleSaveEdit() {
    if (!editMember) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/college/faculty/${editMember.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Faculty record updated" });
      setEditMember(null);
      void load(statusFilter);
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setEditSaving(false);
    }
  }

  const STATUS_TABS = [
    { key: "", label: "All" },
    { key: "ACTIVE", label: "Active" },
    { key: "ON_LEAVE", label: "On Leave" },
    { key: "RESIGNED", label: "Resigned" },
    { key: "RETIRED", label: "Retired" },
  ];

  const columns: Column<FacultyRow>[] = [
    {
      key: "name",
      header: "Faculty Member",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name as string}</p>
          <p className="text-xs text-muted-foreground">{row.email as string}</p>
          <p className="text-xs text-muted-foreground">ID: {row.employeeId as string}</p>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => (
        <div>
          <p className="text-sm font-medium">
            {DESIGNATION_LABELS[row.designation as Designation] ?? (row.designation as string)}
          </p>
          <p className="text-xs text-muted-foreground">{row.qualification as string}</p>
        </div>
      ),
    },
    {
      key: "employmentType",
      header: "Type",
      hideOnMobile: true,
      render: (row) => (
        <Badge variant="outline">
          {EMPLOYMENT_TYPE_LABELS[row.employmentType as EmploymentType] ?? (row.employmentType as string)}
        </Badge>
      ),
    },
    {
      key: "experienceYears",
      header: "Exp.",
      hideOnMobile: true,
      render: (row) => <span>{row.experienceYears as number} yrs</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
          {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? (row.status as string)}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); openEdit(row); }}
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="ml-1 hidden sm:inline">Edit</span>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Register"
        description="Teaching staff and faculty records for your department"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/hod/faculty/import")}>
              <Upload className="h-4 w-4 mr-2" />
              Import
            </Button>
            <Button onClick={() => router.push("/hod/faculty/new")}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Faculty
            </Button>
          </div>
        }
      />

      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              statusFilter === tab.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background border-border hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <DataTable
        data={faculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["name", "email", "employeeId", "specialization"] as (keyof FacultyRow)[]}
        emptyTitle="No faculty records yet"
        emptyDescription="Add faculty members to build your department's staff register"
        emptyAction={
          <Button onClick={() => router.push("/hod/faculty/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Faculty
          </Button>
        }
        csvFilename="faculty"
      />

      {/* Edit Dialog */}
      <Dialog open={!!editMember} onOpenChange={(open) => !open && setEditMember(null)}>
        <DialogContent aria-describedby={undefined} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Faculty Record — {editMember?.name as string}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Designation</Label>
                <Select
                  value={editForm.designation}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, designation: v as Designation }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(DESIGNATION_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Employment Type</Label>
                <Select
                  value={editForm.employmentType}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, employmentType: v as EmploymentType }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Qualification</Label>
                <Input
                  value={editForm.qualification}
                  onChange={(e) => setEditForm((f) => ({ ...f, qualification: e.target.value }))}
                  placeholder="e.g. Ph.D, M.Tech"
                />
              </div>
              <div className="space-y-2">
                <Label>Experience (years)</Label>
                <Input
                  type="number"
                  min={0}
                  value={editForm.experienceYears}
                  onChange={(e) => setEditForm((f) => ({ ...f, experienceYears: Number(e.target.value) }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Specialization</Label>
              <Input
                value={editForm.specialization}
                onChange={(e) => setEditForm((f) => ({ ...f, specialization: e.target.value }))}
                placeholder="e.g. Machine Learning, VLSI"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={editForm.phone}
                  onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                  placeholder="+91 98765 43210"
                />
              </div>
              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, status: v as FacultyStatus }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(FACULTY_STATUS_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMember(null)} disabled={editSaving}>Cancel</Button>
            <Button onClick={handleSaveEdit} loading={editSaving}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
