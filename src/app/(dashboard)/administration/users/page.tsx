"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, UserX, UserCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { useMobile } from "@/hooks/useMobile";
import { useAuthStore } from "@/store/authStore";
import { ROLE_LABELS } from "@/types";
import type { FMSUser } from "@/types";

export default function AdministrationUsersPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const locationId = useAuthStore((s) => s.user?.locationId) ?? "";
  const [users, setUsers] = useState<FMSUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionUid, setActionUid] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<{ user: FMSUser; action: "deactivate" | "activate" | "delete" } | null>(null);

  function loadUsers() {
    setIsLoading(true);
    fetch("/api/location/users")
      .then((r) => r.json() as Promise<{ users: FMSUser[] }>)
      .then((d) => setUsers(d.users ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load users" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadUsers(); }, []);

  async function handleToggleActive(user: FMSUser, isActive: boolean) {
    setActionUid(user.uid);
    try {
      const res = await fetch(`/api/location/users/${user.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, isActive }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: isActive ? "Staff member activated" : "Staff member deactivated" });
      setUsers((prev) => prev.map((u) => u.uid === user.uid ? { ...u, isActive } : u));
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setActionUid(null);
      setConfirmUser(null);
    }
  }

  async function handleDelete(user: FMSUser) {
    setActionUid(user.uid);
    try {
      const res = await fetch(`/api/location/users/${user.uid}?locationId=${locationId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Staff member deleted" });
      setUsers((prev) => prev.filter((u) => u.uid !== user.uid));
    } catch {
      toast({ variant: "destructive", title: "Failed to delete staff member" });
    } finally {
      setActionUid(null);
      setConfirmUser(null);
    }
  }

  // Always icon + text, on both the mobile cards and the desktop table - the
  // desktop branch only ever renders on a wide-enough viewport in the first
  // place (useMobile() swaps the whole list over to MobileCard below that),
  // so there's no width pressure that would justify icon-only there.
  function actionButtons(u: FMSUser) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); router.push(`/administration/users/${u.uid}/edit`); }}
        >
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
        {u.isActive ? (
          <Button
            variant="ghost"
            size="sm"
            loading={actionUid === u.uid}
            onClick={(e) => { e.stopPropagation(); setConfirmUser({ user: u, action: "deactivate" }); }}
          >
            <UserX className="h-3.5 w-3.5 mr-1 text-destructive" />
            <span className="text-destructive">Deactivate</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            loading={actionUid === u.uid}
            onClick={(e) => { e.stopPropagation(); setConfirmUser({ user: u, action: "activate" }); }}
          >
            <UserCheck className="h-3.5 w-3.5 mr-1 text-green-600" />
            <span className="text-green-600">Activate</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          loading={actionUid === u.uid}
          onClick={(e) => { e.stopPropagation(); setConfirmUser({ user: u, action: "delete" }); }}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Location Staff"
        description="HR Admin, Admin Office and Accounts staff for this location"
        actions={
          <Button asChild>
            <Link href="/administration/users/new">+ Add Staff</Link>
          </Button>
        }
      />

      {isMobile ? (
        <div className="space-y-3">
          {users.map((u) => (
            <MobileCard
              key={u.uid}
              title={u.name}
              subtitle={u.email}
              badge={<Badge variant="secondary">{ROLE_LABELS[u.role] ?? u.role}</Badge>}
              fields={[{ label: "Status", value: u.isActive ? "Active" : "Inactive" }]}
              actions={actionButtons(u)}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={users as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => (r as unknown as FMSUser).uid}
          isLoading={isLoading}
          searchPlaceholder="Search staff..."
          searchKeys={["name", "email"]}
          csvFilename="location-staff"
          columns={[
            { key: "name", header: "Name" },
            { key: "email", header: "Email" },
            {
              key: "role", header: "Role",
              render: (r) => <Badge variant="secondary">{ROLE_LABELS[(r as unknown as FMSUser).role] ?? (r as unknown as FMSUser).role}</Badge>,
            },
            {
              key: "isActive", header: "Status",
              render: (r) => <Badge variant={(r as unknown as FMSUser).isActive ? "default" : "secondary"}>{(r as unknown as FMSUser).isActive ? "Active" : "Inactive"}</Badge>,
            },
            {
              // w-px forces this column to shrink-to-fit its content instead
              // of absorbing the table's leftover width - without it, the
              // browser was giving this (header-less) column most of the
              // extra space, leaving a wide empty gap after Delete on any
              // screen wider than the buttons need.
              key: "actions", header: "", className: "w-px",
              render: (r) => <div className="flex items-center gap-1 whitespace-nowrap">{actionButtons(r as unknown as FMSUser)}</div>,
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!confirmUser}
        onOpenChange={(open) => !open && setConfirmUser(null)}
        title={
          confirmUser?.action === "delete"
            ? "Delete Staff Member?"
            : confirmUser?.action === "activate"
            ? "Activate Staff Member?"
            : "Deactivate Staff Member?"
        }
        description={
          confirmUser?.action === "delete"
            ? `Permanently delete ${confirmUser?.user?.name}? This removes their account and login, and can't be undone.`
            : confirmUser?.action === "activate"
            ? `Allow ${confirmUser?.user?.name} to log in again?`
            : `Block ${confirmUser?.user?.name} from logging in? Their data is preserved and this can be reversed later.`
        }
        confirmLabel={
          confirmUser?.action === "delete"
            ? "Delete"
            : confirmUser?.action === "activate"
            ? "Activate"
            : "Deactivate"
        }
        variant={confirmUser?.action === "activate" ? "default" : "destructive"}
        loading={actionUid === confirmUser?.user?.uid}
        onConfirm={() => {
          if (!confirmUser) return;
          if (confirmUser.action === "delete") void handleDelete(confirmUser.user);
          else void handleToggleActive(confirmUser.user, confirmUser.action === "activate");
        }}
      />
    </div>
  );
}
