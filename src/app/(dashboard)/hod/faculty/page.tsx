"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, Upload, Download, Trash2, LogIn, Eye, EyeOff } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { exportFacultyCsv } from "@/lib/faculty/exportFacultyCsv";
import { DESIGNATION_LABELS, EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyMember, Designation, EmploymentType, FacultyStatus, TeachingAssignment } from "@/types";

function fmtDate(val: unknown): string {
  if (!val) return "—";
  try {
    const ts = val as { toDate?: () => Date; seconds?: number; _seconds?: number } | null;
    const d = typeof ts?.toDate === "function"
      ? ts.toDate()
      : ts?._seconds != null
        ? new Date(ts._seconds * 1000)
        : ts?.seconds != null
          ? new Date(ts.seconds * 1000)
          : null;
    if (!d || isNaN(d.getTime())) return "—";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch { return "—"; }
}

function fmtExp(val: unknown): string {
  if (val == null || val === "") return "0";
  return String(+(Number(val).toFixed(1)));
}

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

  const [deleteTarget, setDeleteTarget] = useState<FacultyRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [loginTarget, setLoginTarget] = useState<FacultyRow | null>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [isCreatingLogin, setIsCreatingLogin] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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

  async function handleExportAll() {
    setIsExporting(true);
    try {
      const teachingSummaries: Record<string, string> = {};
      try {
        const res = await fetch("/api/college/teaching-assignments?dept=true");
        const data = await res.json() as { assignments?: TeachingAssignment[] };
        for (const a of data.assignments ?? []) {
          const entry = `${a.courseName} Y${a.year}-${a.sectionName}: ${a.subjectName}`;
          teachingSummaries[a.facultyId] = teachingSummaries[a.facultyId] ? `${teachingSummaries[a.facultyId]}; ${entry}` : entry;
        }
      } catch { /* export still proceeds without the teaching summary column */ }

      exportFacultyCsv(faculty, teachingSummaries);
    } finally {
      setIsExporting(false);
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
        <div className="space-y-0.5 min-w-0">
          <p className="font-medium leading-tight">{row.name as string}</p>
          {(row.collegeEmail as string) && (
            <p className="text-xs text-muted-foreground">{row.collegeEmail as string}</p>
          )}
          <p className="text-xs text-muted-foreground">{row.email as string}</p>
          <p className="text-xs text-muted-foreground">ID: {row.employeeId as string}</p>
          <p className="text-xs text-muted-foreground">Joined: {fmtDate(row.joiningDate)}</p>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Academic Profile",
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{DESIGNATION_LABELS[row.designation as Designation] ?? (row.designation as string)}</p>
          <p className="text-xs text-muted-foreground">{row.qualification as string}</p>
          {(row.specialization as string) && (
            <p className="text-xs text-muted-foreground italic">{row.specialization as string}</p>
          )}
          {(row.hasPHD as boolean) && (
            <span className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">Ph.D</span>
          )}
        </div>
      ),
    },
    {
      key: "employmentType",
      header: "Employment",
      hideOnMobile: true,
      render: (row) => (
        <div className="space-y-1">
          <Badge variant="outline">{EMPLOYMENT_TYPE_LABELS[row.employmentType as EmploymentType] ?? (row.employmentType as string)}</Badge>
          <p className="text-xs text-muted-foreground">{fmtDate(row.joiningDate)}</p>
        </div>
      ),
    },
    {
      key: "experienceYears",
      header: "Experience",
      hideOnMobile: true,
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{fmtExp(row.experienceYears)} yrs</p>
          {Number(row.internalExperience) > 0 && (
            <p className="text-xs text-muted-foreground">Int: {fmtExp(row.internalExperience)} · Ext: {fmtExp(row.externalExperience)}</p>
          )}
          {Number(row.industryExperience) > 0 && (
            <p className="text-xs text-muted-foreground">Industry: {fmtExp(row.industryExperience)} yrs</p>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="space-y-1">
          <Badge variant={STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
            {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? (row.status as string)}
          </Badge>
          {(row.ratificationStatus as string) && (
            <p className={`text-[10px] font-medium ${row.ratificationStatus === "Ratified" ? "text-green-600" : "text-amber-600"}`}>
              {row.ratificationStatus as string}
            </p>
          )}
        </div>
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
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/hod/faculty/${row.id}/edit`); }}>
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
            <Button variant="outline" onClick={() => void handleExportAll()} loading={isExporting} disabled={isExporting || faculty.length === 0}>
              <Download className="h-4 w-4 mr-2" />Export All Details
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
