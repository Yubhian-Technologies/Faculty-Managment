"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, Upload, Trash2, LogIn, Eye, EyeOff } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyMember, Designation, EmploymentType, FacultyStatus } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

type EditForm = {
  // Employment
  designation: Designation;
  employmentType: EmploymentType;
  qualification: string;
  specialization: string;
  status: FacultyStatus;
  joiningDate: string;
  // Contact
  phone: string;
  collegeEmail: string;
  // Experience
  experienceYears: number | "";
  internalExperience: number | "";
  externalExperience: number | "";
  inCampusExperience: number | "";
  industryExperience: number | "";
  researchExperience: number | "";
  hasPHD: boolean;
  // Personal
  gender: string;
  dateOfBirth: string;
  legalName: string;
  fatherName: string;
  motherName: string;
  religion: string;
  caste: string;
  aadharNo: string;
  panNo: string;
  // Ratification
  ratificationStatus: string;
  ratificationDate: string;
};

function toDateInput(val: unknown): string {
  if (!val) return "";
  try {
    const d = typeof (val as { toDate?: () => Date }).toDate === "function"
      ? (val as { toDate: () => Date }).toDate()
      : new Date((val as { seconds?: number }).seconds ? (val as { seconds: number }).seconds * 1000 : String(val));
    return d.toISOString().split("T")[0];
  } catch { return ""; }
}

function buildEditForm(m: FacultyRow): EditForm {
  return {
    designation: m.designation,
    employmentType: m.employmentType,
    qualification: m.qualification ?? "",
    specialization: (m.specialization as string) ?? "",
    status: m.status,
    joiningDate: toDateInput(m.joiningDate),
    phone: (m.phone as string) ?? "",
    collegeEmail: (m.collegeEmail as string) ?? "",
    experienceYears: (m.experienceYears as number) ?? "",
    internalExperience: (m.internalExperience as number) ?? "",
    externalExperience: (m.externalExperience as number) ?? "",
    inCampusExperience: (m.inCampusExperience as number) ?? "",
    industryExperience: (m.industryExperience as number) ?? "",
    researchExperience: (m.researchExperience as number) ?? "",
    hasPHD: (m.hasPHD as boolean) ?? false,
    gender: (m.gender as string) ?? "",
    dateOfBirth: toDateInput(m.dateOfBirth),
    legalName: (m.legalName as string) ?? "",
    fatherName: (m.fatherName as string) ?? "",
    motherName: (m.motherName as string) ?? "",
    religion: (m.religion as string) ?? "",
    caste: (m.caste as string) ?? "",
    aadharNo: (m.aadharNo as string) ?? "",
    panNo: (m.panNo as string) ?? "",
    ratificationStatus: (m.ratificationStatus as string) ?? "",
    ratificationDate: toDateInput(m.ratificationDate),
  };
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2 pb-1 border-t first:border-t-0 first:pt-0">{children}</p>;
}

export default function HODFacultyPage() {
  const router = useRouter();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const [editMember, setEditMember] = useState<FacultyRow | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<FacultyRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [loginTarget, setLoginTarget] = useState<FacultyRow | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingLogin, setIsCreatingLogin] = useState(false);

  async function load(status: string) {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/faculty${status ? `?status=${status}` : ""}`);
      const data = await res.json() as { faculty: FacultyRow[] };
      setFaculty(data.faculty ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load faculty" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(statusFilter); }, [statusFilter]);

  function set(patch: Partial<EditForm>) {
    setEditForm((f) => f ? { ...f, ...patch } : f);
  }

  async function handleSaveEdit() {
    if (!editMember || !editForm) return;
    if (!editForm.collegeEmail.trim()) {
      toast({ variant: "destructive", title: "College email is required" });
      return;
    }
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

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/faculty/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `${deleteTarget.name as string} removed from faculty register` });
      setDeleteTarget(null);
      void load(statusFilter);
    } catch {
      toast({ variant: "destructive", title: "Failed to delete faculty record" });
    } finally {
      setIsDeleting(false);
    }
  }

  function openLoginDialog(row: FacultyRow) {
    setLoginTarget(row);
    setLoginForm({
      email: (row.collegeEmail as string) || (row.email as string) || "",
      password: "",
    });
    setShowPassword(false);
  }

  async function handleCreateLogin() {
    if (!loginTarget) return;
    if (!loginForm.email.trim()) {
      toast({ variant: "destructive", title: "Email is required" });
      return;
    }
    if (loginForm.password.length < 8) {
      toast({ variant: "destructive", title: "Password must be at least 8 characters" });
      return;
    }
    setIsCreatingLogin(true);
    try {
      const res = await fetch(`/api/college/faculty/${loginTarget.id as string}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(loginForm),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to create login" });
        return;
      }
      toast({ variant: "success", title: `Login created for ${loginTarget.name as string}` });
      setLoginTarget(null);
      void load(statusFilter);
    } catch {
      toast({ variant: "destructive", title: "Network error, please try again" });
    } finally {
      setIsCreatingLogin(false);
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
          <p className="text-xs text-muted-foreground">{(row.collegeEmail as string) || (row.email as string)}</p>
          <p className="text-xs text-muted-foreground">ID: {row.employeeId as string}</p>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => (
        <div>
          <p className="text-sm font-medium">{DESIGNATION_LABELS[row.designation as Designation] ?? (row.designation as string)}</p>
          <p className="text-xs text-muted-foreground">{row.qualification as string}</p>
        </div>
      ),
    },
    {
      key: "employmentType",
      header: "Type",
      hideOnMobile: true,
      render: (row) => (
        <Badge variant="outline">{EMPLOYMENT_TYPE_LABELS[row.employmentType as EmploymentType] ?? (row.employmentType as string)}</Badge>
      ),
    },
    {
      key: "experienceYears",
      header: "Exp.",
      hideOnMobile: true,
      render: (row) => <span>{(row.experienceYears as number) ?? 0} yrs</span>,
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
        <div className="flex items-center gap-1">
          {!(row.userUid as string) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
              title="Create login account"
              onClick={(e) => { e.stopPropagation(); openLoginDialog(row); }}
            >
              <LogIn className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Set Login</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setEditMember(row); setEditForm(buildEditForm(row)); }}>
            <Pencil className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
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
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Button onClick={() => router.push("/hod/faculty/new")}>
              <UserPlus className="h-4 w-4 mr-2" />Add Faculty
            </Button>
          </div>
        }
      />

      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${statusFilter === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}>
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
        emptyAction={<Button onClick={() => router.push("/hod/faculty/new")}><UserPlus className="h-4 w-4 mr-2" />Add Faculty</Button>}
        csvFilename="faculty"
      />

      {/* ── Edit Dialog ── */}
      <Dialog open={!!editMember} onOpenChange={(open) => { if (!open) { setEditMember(null); setEditForm(null); } }}>
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit — {editMember?.name as string}</DialogTitle>
            <p className="text-xs text-muted-foreground">Employee ID: {editMember?.employeeId as string} · {editMember?.email as string}</p>
          </DialogHeader>

          {editForm && (
            <div className="space-y-4 py-1">

              <SectionLabel>Employment</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Designation *</Label>
                  <Select value={editForm.designation} onValueChange={(v) => set({ designation: v as Designation })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(DESIGNATION_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Employment Type *</Label>
                  <Select value={editForm.employmentType} onValueChange={(v) => set({ employmentType: v as EmploymentType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(EMPLOYMENT_TYPE_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Qualification *</Label>
                  <Input value={editForm.qualification} onChange={(e) => set({ qualification: e.target.value })} placeholder="e.g. Ph.D, M.Tech" />
                </div>
                <div className="space-y-1.5">
                  <Label>Specialization</Label>
                  <Input value={editForm.specialization} onChange={(e) => set({ specialization: e.target.value })} placeholder="e.g. Machine Learning" />
                </div>
                <div className="space-y-1.5">
                  <Label>Status *</Label>
                  <Select value={editForm.status} onValueChange={(v) => set({ status: v as FacultyStatus })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{Object.entries(FACULTY_STATUS_LABELS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Joining Date</Label>
                  <Input type="date" value={editForm.joiningDate} onChange={(e) => set({ joiningDate: e.target.value })} />
                </div>
              </div>

              <SectionLabel>Contact</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={editForm.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="9876543210" />
                </div>
                <div className="space-y-1.5">
                  <Label>College Email *</Label>
                  <Input type="email" value={editForm.collegeEmail} onChange={(e) => set({ collegeEmail: e.target.value })} placeholder="name@vishnu.edu.in" />
                </div>
              </div>

              <SectionLabel>Experience (Years)</SectionLabel>
              <div className="grid grid-cols-3 gap-3">
                {([
                  ["experienceYears",   "Total Experience"],
                  ["internalExperience","Internal"],
                  ["externalExperience","External"],
                  ["inCampusExperience","In Campus"],
                  ["industryExperience","Industry"],
                  ["researchExperience","Research"],
                ] as [keyof EditForm, string][]).map(([key, label]) => (
                  <div key={key} className="space-y-1.5">
                    <Label>{label}</Label>
                    <Input type="number" min={0} step={0.1}
                      value={editForm[key] as number | ""}
                      onChange={(e) => set({ [key]: e.target.value === "" ? "" : parseFloat(e.target.value) } as Partial<EditForm>)}
                      placeholder="0"
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="hasPHD" checked={editForm.hasPHD} onChange={(e) => set({ hasPHD: e.target.checked })} className="h-4 w-4 rounded border-gray-300" />
                <Label htmlFor="hasPHD" className="cursor-pointer">Has Ph.D</Label>
              </div>

              <SectionLabel>Personal Details</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Gender</Label>
                  <Select value={editForm.gender} onValueChange={(v) => set({ gender: v })}>
                    <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Date of Birth</Label>
                  <Input type="date" value={editForm.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Legal Name (as per SSC)</Label>
                  <Input value={editForm.legalName} onChange={(e) => set({ legalName: e.target.value.toUpperCase() })} placeholder="FULL NAME IN CAPITALS" className="uppercase" />
                </div>
                <div className="space-y-1.5">
                  <Label>Father / Husband Name</Label>
                  <Input value={editForm.fatherName} onChange={(e) => set({ fatherName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Mother Name</Label>
                  <Input value={editForm.motherName} onChange={(e) => set({ motherName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Religion</Label>
                  <Input value={editForm.religion} onChange={(e) => set({ religion: e.target.value })} placeholder="e.g. Hindu" />
                </div>
                <div className="space-y-1.5">
                  <Label>Caste</Label>
                  <Input value={editForm.caste} onChange={(e) => set({ caste: e.target.value })} placeholder="e.g. OC, BC-B" />
                </div>
                <div className="space-y-1.5">
                  <Label>Aadhar No</Label>
                  <Input value={editForm.aadharNo} onChange={(e) => set({ aadharNo: e.target.value })} placeholder="1234 5678 9012" maxLength={14} />
                </div>
                <div className="space-y-1.5">
                  <Label>PAN No</Label>
                  <Input value={editForm.panNo} onChange={(e) => set({ panNo: e.target.value.toUpperCase() })} placeholder="ABCDE1234F" maxLength={10} className="uppercase" />
                </div>
              </div>

              <SectionLabel>Ratification</SectionLabel>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Ratification Status</Label>
                  <Select value={editForm.ratificationStatus} onValueChange={(v) => set({ ratificationStatus: v })}>
                    <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Ratified">Ratified</SelectItem>
                      <SelectItem value="Not Ratified">Not Ratified</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Ratification Date</Label>
                  <Input type="date" value={editForm.ratificationDate} onChange={(e) => set({ ratificationDate: e.target.value })} />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditMember(null); setEditForm(null); }} disabled={editSaving}>Cancel</Button>
            <Button onClick={() => void handleSaveEdit()} loading={editSaving}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Create Login Dialog ── */}
      <Dialog open={!!loginTarget} onOpenChange={(open) => { if (!open) setLoginTarget(null); }}>
        <DialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Login — {loginTarget?.name as string}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              This will create a system login account for this faculty member. They can sign in as a Panel Member.
            </p>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Login Email *</Label>
              <Input
                type="email"
                value={loginForm.email}
                onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="name@college.edu.in"
              />
              <p className="text-xs text-muted-foreground">Pre-filled from college email. Change if needed.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Password *</Label>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={loginForm.password}
                  onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Min 8 characters"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Share this password with the faculty member so they can log in.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLoginTarget(null)} disabled={isCreatingLogin}>Cancel</Button>
            <Button onClick={() => void handleCreateLogin()} loading={isCreatingLogin}>
              <LogIn className="h-4 w-4 mr-2" />Create Login
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm ── */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete faculty record?"
        description={`This will permanently remove ${(deleteTarget?.name as string) ?? "this faculty member"} (${(deleteTarget?.employeeId as string) ?? ""}) from the register. This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
