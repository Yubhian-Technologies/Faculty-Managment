"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserX, Pencil, Download, FileDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Avatar } from "@/components/shared/Avatar";
import { toast } from "@/hooks/useToast";
import { exportStaffCsv } from "@/lib/faculty/exportStaffCsv";
import { downloadResumePdf } from "@/lib/pdf/downloadResume";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

type UserRow = Record<string, unknown> & FMSUser;

const ROLE_TABS = [
  { key: "", label: "All Staff" },
  { key: "HOD", label: "Head of Dept." },
  { key: "VICE_PRINCIPAL", label: "Vice Principal" },
  { key: "COLLEGE_OFFICE", label: "College Office" },
];

const STATUS_TABS = [
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
  { key: "all", label: "All" },
] as const;
type StatusFilter = (typeof STATUS_TABS)[number]["key"];

export default function PrincipalStaffPage() {
  const router = useRouter();
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<UserRow | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [downloadingResumeUid, setDownloadingResumeUid] = useState<string | null>(null);
  const [collegeName, setCollegeName] = useState("");

  useEffect(() => {
    fetch("/api/college/info")
      .then((r) => r.json() as Promise<{ name?: string }>)
      .then((d) => setCollegeName(d.name ?? ""))
      .catch(() => {});
  }, []);

  async function load(role: string) {
    setIsLoading(true);
    try {
      const url = `/api/college/users${role ? `?role=${role}` : ""}`;
      const res = await fetch(url);
      const data = await res.json() as { users?: UserRow[]; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: data.error ?? `Failed to load staff (${res.status})` });
        setUsers([]);
        return;
      }
      setUsers(data.users ?? []);
    } catch {
      toast({ variant: "destructive", title: "Network error — failed to load staff" });
      setUsers([]);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(roleFilter); }, [roleFilter]);

  const visibleUsers = users.filter((u) => {
    if (statusFilter === "all") return true;
    const active = u.isActive as boolean;
    return statusFilter === "active" ? active : !active;
  });

  function handleExportAll() {
    setIsExporting(true);
    try {
      exportStaffCsv(visibleUsers);
    } finally {
      setIsExporting(false);
    }
  }

  async function handleDownloadResume(user: UserRow) {
    setDownloadingResumeUid(user.uid);
    try {
      await downloadResumePdf({ ...user, collegeName }, (user.employeeId as string) || user.name);
    } catch {
      toast({ variant: "destructive", title: "Failed to generate resume" });
    } finally {
      setDownloadingResumeUid(null);
    }
  }

  async function handleDeactivate(user: UserRow) {
    setDeactivating(user.uid);
    try {
      const res = await fetch(`/api/college/users/${user.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Staff member deactivated" });
      setUsers((prev) => prev.map((u) => u.uid === user.uid ? { ...u, isActive: false } : u));
    } catch {
      toast({ variant: "destructive", title: "Failed to deactivate" });
    } finally {
      setDeactivating(null);
      setConfirmUser(null);
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name as string} photoUrl={row.profilePhotoUrl as string | undefined} size="sm" />
          <div>
            <p className="font-medium">{row.name as string}</p>
            <p className="text-xs text-muted-foreground">{row.email as string}</p>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge variant="outline">
          {ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? (row.role as string)}
        </Badge>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (row) => <span>{(row.department as string) || "—"}</span>,
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <Badge variant={(row.isActive as boolean) ? "default" : "secondary"}>
          {(row.isActive as boolean) ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => { e.stopPropagation(); router.push(`/principal/staff/${row.uid}/edit`); }}
          >
            <Pencil className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title="Download resume PDF"
            loading={downloadingResumeUid === (row.uid as string)}
            onClick={(e) => { e.stopPropagation(); void handleDownloadResume(row); }}
          >
            <FileDown className="h-3.5 w-3.5" />
            <span className="ml-1 hidden sm:inline">Download</span>
          </Button>
          {(row.isActive as boolean) && (
            <Button
              variant="ghost"
              size="sm"
              loading={deactivating === (row.uid as string)}
              onClick={(e) => { e.stopPropagation(); setConfirmUser(row); }}
            >
              <UserX className="h-4 w-4 text-destructive" />
              <span className="ml-1 hidden sm:inline text-destructive">Deactivate</span>
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Staff Management"
        description="Manage HODs and College Office staff"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleExportAll} loading={isExporting} disabled={isExporting || visibleUsers.length === 0}>
              <Download className="h-4 w-4 mr-2" />Export All Details
            </Button>
            <Button onClick={() => router.push("/principal/staff/new")}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add Staff
            </Button>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {ROLE_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setRoleFilter(tab.key)}
              className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                roleFilter === tab.key
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg border p-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                statusFilter === tab.key
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <DataTable
        data={visibleUsers}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.uid as string}
        searchPlaceholder="Search staff..."
        searchKeys={["name", "email", "department"] as (keyof UserRow)[]}
        emptyTitle={statusFilter === "active" ? "No active staff members" : "No staff members yet"}
        emptyDescription="Add HODs, College Office staff, and Accounts"
        emptyAction={
          <Button onClick={() => router.push("/principal/staff/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Staff
          </Button>
        }
      />

      <ConfirmDialog
        open={!!confirmUser}
        onOpenChange={(open) => !open && setConfirmUser(null)}
        title="Deactivate Staff Member?"
        description={`${confirmUser?.name as string} will lose access immediately. Data is preserved.`}
        confirmLabel="Deactivate"
        variant="destructive"
        onConfirm={() => { if (confirmUser) void handleDeactivate(confirmUser); }}
      />
    </div>
  );
}
