"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserX, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Avatar } from "@/components/shared/Avatar";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

type UserRow = Record<string, unknown> & FMSUser;

const ROLE_TABS = [
  { key: "", label: "All Staff" },
  { key: "HOD", label: "Head of Dept." },
  { key: "VICE_PRINCIPAL", label: "Vice Principal" },
  { key: "COLLEGE_OFFICE", label: "College Office" },
];

export default function PrincipalStaffPage() {
  const router = useRouter();
  const [roleFilter, setRoleFilter] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deactivating, setDeactivating] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<UserRow | null>(null);

  async function load(role: string) {
    setIsLoading(true);
    try {
      const url = `/api/college/users${role ? `?role=${role}` : ""}`;
      const res = await fetch(url);
      const data = await res.json() as { users: UserRow[] };
      setUsers(data.users ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load staff" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(roleFilter); }, [roleFilter]);

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
          <Button onClick={() => router.push("/principal/staff/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Staff
          </Button>
        }
      />

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

      <DataTable
        data={users}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.uid as string}
        searchPlaceholder="Search staff..."
        searchKeys={["name", "email", "department"] as (keyof UserRow)[]}
        emptyTitle="No staff members yet"
        emptyDescription="Add HODs, College Office staff, and Accounts"
        emptyAction={
          <Button onClick={() => router.push("/principal/staff/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Staff
          </Button>
        }
        csvFilename="staff"
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
