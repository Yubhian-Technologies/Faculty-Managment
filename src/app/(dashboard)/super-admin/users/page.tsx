"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserX, UserCheck, Pencil, KeyRound, Trash2, Globe, FileDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Avatar } from "@/components/shared/Avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { downloadResumePdf } from "@/lib/pdf/downloadResume";
import { ROLE_LABELS } from "@/types";
import type { FMSUser, UserRole } from "@/types";
import type { College, Location } from "@/types";

type UserRow = Record<string, unknown> & FMSUser;

const GLOBAL_SCOPE = "__system__";
const LOCATION_PREFIX = "loc:";

// Super Admin only edits the photo for the roles it directly administers — everyone
// else's photo is edited from their own manager's dashboard (Principal for HOD/VP,
// HOD for faculty) and is still visible here, just not editable.
const PHOTO_EDITABLE_ROLES: UserRole[] = ["PRINCIPAL", "ACCOUNTS", "FINANCE", "PURCHASE_DEPT", "ADMINISTRATION", "MANAGEMENT"];

export default function UsersPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<College[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedCollegeId, setSelectedCollegeId] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionUid, setActionUid] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<{ user: UserRow; action: "deactivate" | "activate" | "delete" } | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [downloadingResumeUid, setDownloadingResumeUid] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((data) => {
        const c = data.colleges ?? [];
        setColleges(c);
        if (c.length > 0) setSelectedCollegeId(c[0].id);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }));

    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((data) => setLocations(data.locations ?? []))
      .catch(() => {});
  }, []);

  function usersUrl() {
    if (selectedCollegeId === GLOBAL_SCOPE) return "/api/admin/users?scope=global";
    if (selectedCollegeId.startsWith(LOCATION_PREFIX)) {
      return `/api/location/users?locationId=${selectedCollegeId.slice(LOCATION_PREFIX.length)}`;
    }
    return `/api/admin/users?collegeId=${selectedCollegeId}`;
  }

  useEffect(() => {
    if (!selectedCollegeId) return;
    setIsLoading(true);
    fetch(usersUrl())
      .then((r) => r.json())
      .then((data: { users: UserRow[] }) => setUsers(data.users ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load users" }))
      .finally(() => setIsLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollegeId]);

  async function handleToggleActive(user: UserRow, isActive: boolean) {
    setActionUid(user.uid);
    try {
      const res = await fetch(`/api/admin/users/${user.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId: user.collegeId, isActive }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: isActive ? "User activated" : "User deactivated" });
      setUsers((prev) => prev.map((u) => u.uid === user.uid ? { ...u, isActive } : u));
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setActionUid(null);
      setConfirmUser(null);
    }
  }

  async function handleDelete(user: UserRow) {
    setActionUid(user.uid);
    try {
      const collegeId = user.collegeId || selectedCollegeId;
      const res = await fetch(`/api/admin/users/${user.uid}?collegeId=${collegeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "User deleted" });
      setUsers((prev) => prev.filter((u) => u.uid !== user.uid));
    } catch {
      toast({ variant: "destructive", title: "Failed to delete user" });
    } finally {
      setActionUid(null);
      setConfirmUser(null);
    }
  }

  async function handleResetPassword() {
    if (!resetUser || newPassword.length < 6) {
      toast({ variant: "destructive", title: "Password must be at least 6 characters" });
      return;
    }
    setResetSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${resetUser.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId: resetUser.collegeId, newPassword }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Password reset successfully" });
      setResetUser(null);
      setNewPassword("");
    } catch {
      toast({ variant: "destructive", title: "Failed to reset password" });
    } finally {
      setResetSaving(false);
    }
  }

  async function handleDownloadResume(user: UserRow) {
    setDownloadingResumeUid(user.uid);
    try {
      const collegeName = colleges.find((c) => c.id === user.collegeId)?.name ?? "";
      await downloadResumePdf({ ...user, collegeName }, (user.employeeId as string) || (user.name as string));
    } catch {
      toast({ variant: "destructive", title: "Failed to generate resume" });
    } finally {
      setDownloadingResumeUid(null);
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
      render: (row) =>
        !(row.collegeId as string) && !(row.locationId as string) ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="h-3 w-3" />System-Wide
          </span>
        ) : (
          <span>{(row.department as string) || "—"}</span>
        ),
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
      render: (row) => {
        // Edit (including the photo) is available for the 6 roles Super Admin
        // administers. Reset/Activate/Deactivate only exist for college-scoped
        // users today. Delete also works for global (Management) users — but not
        // location-scoped (Administration) ones, since the delete route doesn't
        // know how to clean up a locationUsers doc yet.
        const isCollegeScoped = !!(row.collegeId as string);
        const isLocationScoped = !isCollegeScoped && !!(row.locationId as string);
        const canEdit = PHOTO_EDITABLE_ROLES.includes(row.role);
        const editHref = `/super-admin/users/${row.uid}/edit?role=${row.role}` +
          (row.collegeId ? `&collegeId=${row.collegeId}` : "") +
          (row.locationId ? `&locationId=${row.locationId}` : "");
        return (
          <div className="flex items-center gap-1 flex-wrap">
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(editHref); }}>
                <Pencil className="h-3.5 w-3.5" />
                <span className="ml-1 hidden lg:inline">Edit</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              title="Download resume PDF"
              loading={downloadingResumeUid === (row.uid as string)}
              onClick={(e) => { e.stopPropagation(); void handleDownloadResume(row); }}
            >
              <FileDown className="h-3.5 w-3.5" />
              <span className="ml-1 hidden lg:inline">Download</span>
            </Button>
            {isCollegeScoped && (
              <>
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setResetUser(row); setNewPassword(""); }}>
                  <KeyRound className="h-3.5 w-3.5" />
                  <span className="ml-1 hidden lg:inline">Reset</span>
                </Button>
                {(row.isActive as boolean) ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={actionUid === (row.uid as string)}
                    onClick={(e) => { e.stopPropagation(); setConfirmUser({ user: row, action: "deactivate" }); }}
                  >
                    <UserX className="h-3.5 w-3.5 text-destructive" />
                    <span className="ml-1 hidden lg:inline text-destructive">Deactivate</span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={actionUid === (row.uid as string)}
                    onClick={(e) => { e.stopPropagation(); setConfirmUser({ user: row, action: "activate" }); }}
                  >
                    <UserCheck className="h-3.5 w-3.5 text-green-600" />
                    <span className="ml-1 hidden lg:inline text-green-600">Activate</span>
                  </Button>
                )}
              </>
            )}
            {!isLocationScoped && (
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => { e.stopPropagation(); setConfirmUser({ user: row, action: "delete" }); }}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const collegeLabel = selectedCollegeId === GLOBAL_SCOPE
    ? "System-Wide Users"
    : selectedCollegeId.startsWith(LOCATION_PREFIX)
    ? locations.find((l) => l.id === selectedCollegeId.slice(LOCATION_PREFIX.length))?.name ?? "Location"
    : colleges.find((c) => c.id === selectedCollegeId)?.name ?? "All Users";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Manage staff accounts across colleges"
        actions={
          <Button onClick={() => router.push("/super-admin/users/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        }
      />

      {colleges.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground font-medium">College:</span>
          <div className="flex gap-2 flex-wrap">
            {colleges.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCollegeId(c.id)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  selectedCollegeId === c.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {c.name}
              </button>
            ))}
            <button
              onClick={() => setSelectedCollegeId(GLOBAL_SCOPE)}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm border transition-colors ${
                selectedCollegeId === GLOBAL_SCOPE
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border hover:bg-muted"
              }`}
            >
              <Globe className="h-3.5 w-3.5" />System-Wide
            </button>
          </div>
        </div>
      )}

      {locations.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-muted-foreground font-medium">Location:</span>
          <div className="flex gap-2 flex-wrap">
            {locations.map((l) => (
              <button
                key={l.id}
                onClick={() => setSelectedCollegeId(`${LOCATION_PREFIX}${l.id}`)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  selectedCollegeId === `${LOCATION_PREFIX}${l.id}`
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border hover:bg-muted"
                }`}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <DataTable
        data={users}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.uid as string}
        searchPlaceholder="Search users..."
        searchKeys={["name", "email", "department"] as (keyof UserRow)[]}
        emptyTitle={selectedCollegeId === GLOBAL_SCOPE ? "No system-wide users" : `No users in ${collegeLabel}`}
        emptyDescription={selectedCollegeId === GLOBAL_SCOPE ? "Create a Management account to see it here" : "Create the first user for this college"}
        emptyAction={
          <Button onClick={() => router.push("/super-admin/users/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        }
        csvFilename="users"
      />

      {/* Reset Password Dialog */}
      <Dialog open={!!resetUser} onOpenChange={(open) => { if (!open) { setResetUser(null); setNewPassword(""); } }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Set a new password for <strong>{resetUser?.name as string}</strong>.
            </p>
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min 6 characters"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetUser(null); setNewPassword(""); }} disabled={resetSaving}>
              Cancel
            </Button>
            <Button onClick={handleResetPassword} loading={resetSaving}>
              Reset Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={!!confirmUser}
        onOpenChange={(open) => !open && setConfirmUser(null)}
        title={
          confirmUser?.action === "delete"
            ? "Delete User?"
            : confirmUser?.action === "activate"
            ? "Activate User?"
            : "Deactivate User?"
        }
        description={
          confirmUser?.action === "delete"
            ? `Permanently delete ${confirmUser?.user?.name as string}? This cannot be undone.`
            : confirmUser?.action === "activate"
            ? `Allow ${confirmUser?.user?.name as string} to log in again?`
            : `Block ${confirmUser?.user?.name as string} from logging in? Their data is preserved.`
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
