"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserX, UserCheck, Eye, KeyRound, Trash2, Globe, FileDown } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { ROLE_LABELS, DESIGNATION_LABELS } from "@/types";
import type { FMSUser, UserRole, Designation } from "@/types";
import type { College, Location } from "@/types";

type UserRow = Record<string, unknown> & FMSUser;

const GLOBAL_SCOPE = "__system__";
const LOCATION_PREFIX = "loc:";

// Super Admin only edits the photo for the roles it directly administers - everyone
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
  const [hasUsersLoaded, setHasUsersLoaded] = useState(false);
  // Department-wise filter (college-scoped view only)
  const [departmentsList, setDepartmentsList] = useState<{ id: string; name: string }[]>([]);
  const [selectedDeptName, setSelectedDeptName] = useState("");
  const [hasDeptLoaded, setHasDeptLoaded] = useState(false);
  const [isDeptLoading, setIsDeptLoading] = useState(false);
  const ALL_DEPTS = "__ALL__";
  const [actionUid, setActionUid] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<{ user: UserRow; action: "deactivate" | "activate" | "delete" } | null>(null);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  // Read-only fallback for every role that has neither a rich profile hub
  // (PRINCIPAL/DIRECTOR/PANEL_MEMBER) nor a Super-Admin edit form (ACCOUNTS/
  // FINANCE/PURCHASE_DEPT/ADMINISTRATION/MANAGEMENT) - e.g. HOD, VICE_PRINCIPAL,
  // COLLEGE_ADMIN, WEBMASTER, COLLEGE_OFFICE, COLLEGE_ACCOUNTS, COORDINATOR,
  // COLLEGE_STAFF, HR_ADMIN, ADMIN_OFFICE. Those roles used to have no View/Edit
  // action at all on this list. Reuses the row's already-fetched fields - no
  // extra request, no dependency on a role-specific hub/edit route that was
  // never built for them.
  const [viewUser, setViewUser] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetSaving, setResetSaving] = useState(false);
  const [downloadingResumeUid, setDownloadingResumeUid] = useState<string | null>(null);

  // Batch 2: AbortController for users fetch — aborts previous before new, cleanup on unmount
  const usersAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { usersAbortRef.current?.abort(); }, []);

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

  function isCollegeScopedId(id: string) {
    return id !== GLOBAL_SCOPE && !id.startsWith(LOCATION_PREFIX) && !!id;
  }

  function usersUrl() {
    if (selectedCollegeId === GLOBAL_SCOPE) return "/api/admin/users?scope=global";
    if (selectedCollegeId.startsWith(LOCATION_PREFIX)) {
      return `/api/location/users?locationId=${selectedCollegeId.slice(LOCATION_PREFIX.length)}`;
    }
    return `/api/admin/users?collegeId=${selectedCollegeId}`;
  }

  function usersUrlWithDept() {
    const base = usersUrl();
    // Server-aware department prune — additive optimization, keeps client filter as fallback
    if (isCollegeScopedId(selectedCollegeId) && selectedDeptName && selectedDeptName !== ALL_DEPTS) {
      const sep = base.includes("?") ? "&" : "?";
      return `${base}${sep}department=${encodeURIComponent(selectedDeptName)}`;
    }
    return base;
  }

  // Reset state when scope changes
  useEffect(() => {
    if (!selectedCollegeId) return;
    setSelectedDeptName("");
    setHasDeptLoaded(false);
    setHasUsersLoaded(false);
    setUsers([]);
    // Auto-load for global/location scopes; college scope requires explicit Load
    if (!isCollegeScopedId(selectedCollegeId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(true);
      usersAbortRef.current?.abort();
      const ctrl = new AbortController();
      usersAbortRef.current = ctrl;
      fetch(usersUrl(), { signal: ctrl.signal })
        .then((r) => r.json())
        .then((data: { users: UserRow[] }) => {
          setUsers(data.users ?? []);
          setHasUsersLoaded(true);
        })
        .catch((err) => {
          if ((err as Error)?.name === "AbortError") return;
          toast({ variant: "destructive", title: "Failed to load users" });
        })
        .finally(() => setIsLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollegeId]);

  async function handleLoadUsers() {
    if (!selectedCollegeId) {
      toast({ variant: "destructive", title: "Select a college first" });
      return;
    }
    if (isCollegeScopedId(selectedCollegeId) && !selectedDeptName) {
      toast({ variant: "destructive", title: "Select a department", description: "Choose a department or ALL before loading." });
      return;
    }
    // Abort previous in-flight load before starting a new one
    usersAbortRef.current?.abort();
    const ctrl = new AbortController();
    usersAbortRef.current = ctrl;
    setIsLoading(true);
    setHasUsersLoaded(false);
    try {
      const res = await fetch(usersUrlWithDept(), { signal: ctrl.signal });
      const data = (await res.json()) as { users: UserRow[] };
      setUsers(data.users ?? []);
      setHasUsersLoaded(true);
      setHasDeptLoaded(true);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      toast({ variant: "destructive", title: "Failed to load users" });
    } finally {
      setIsLoading(false);
    }
  }

  // Department list for college-scoped view only — uses the location browse
  // route which supports SUPER_ADMIN + ?collegeId=, unlike /api/college/departments
  // which is locked to session.collegeId.
  useEffect(() => {
    if (!isCollegeScopedId(selectedCollegeId)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDepartmentsList([]);
      return;
    }
    setIsDeptLoading(true);
    fetch(`/api/location/college-browse/departments?collegeId=${encodeURIComponent(selectedCollegeId)}`)
      .then((r) => r.json() as Promise<{ departments: { id: string; name: string }[] }>)
      .then((data) => setDepartmentsList(data.departments ?? []))
      .catch(() => setDepartmentsList([]))
      .finally(() => setIsDeptLoading(false));
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
      let researchPublications: unknown[] = [];
      if (user.collegeId) {
        try {
          const pubRes = await fetch(`/api/college/publications?collegeId=${encodeURIComponent(user.collegeId)}&uid=${encodeURIComponent(user.uid)}`);
          const pubData = await pubRes.json() as { publications?: unknown[] };
          researchPublications = pubData.publications ?? [];
        } catch { /* non-critical - resume falls back to self-reported publications, if any */ }
      }
      await downloadResumePdf({ ...user, researchPublications, collegeName }, (user.employeeId as string) || (user.name as string));
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to generate resume" });
    } finally {
      setDownloadingResumeUid(null);
    }
  }

  const columns: Column<UserRow>[] = useMemo(
    () => [
      {
        key: "name",
        header: "Name",
        render: (row) => {
          const isSystemWide = !(row.collegeId as string) && !(row.locationId as string);
          const depts = row.departments && row.departments.length > 0 ? row.departments : [row.department].filter(Boolean) as string[];
          return (
            <div className="flex items-center gap-3">
              <Avatar name={facultyDisplayName(row) || (row.name as string)} photoUrl={row.profilePhotoUrl as string | undefined} size="sm" />
              <div>
                <p className="font-medium">{facultyDisplayName(row) || (row.name as string)}</p>
                <p className="text-xs text-muted-foreground">{row.email as string}</p>
                {isSystemWide ? (
                  <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Globe className="h-3 w-3" />System-Wide
                  </p>
                ) : depts.length > 0 && (
                  <p className="text-xs text-muted-foreground">{depts.join(", ")}</p>
                )}
              </div>
            </div>
          );
        },
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
        key: "designation",
        header: "Designation",
        hideOnMobile: true,
        // PANEL_MEMBER (faculty) / COLLEGE_STAFF (supporting staff) logins are
        // linked to a facultyMembers/supportingStaff record - the API merges
        // that record's details (designation, employeeId, ...) into the row
        // (see /api/admin/users). Every other role has neither field.
        render: (row) => {
          const rawDesignation = row.designation as string | undefined;
          const label = rawDesignation
            ? row.role === "PANEL_MEMBER"
              ? DESIGNATION_LABELS[rawDesignation as Designation] ?? rawDesignation
              : rawDesignation
            : null;
          const employeeId = row.employeeId as string | undefined;
          if (!label && !employeeId) return <span className="text-muted-foreground">-</span>;
          return (
            <div>
              {label && <p>{label}</p>}
              {employeeId && <p className="text-xs text-muted-foreground">{employeeId}</p>}
            </div>
          );
        },
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
          // users today. Delete also works for global (Management) users - but not
          // location-scoped (Administration) ones, since the delete route doesn't
          // know how to clean up a locationUsers doc yet.
          const isCollegeScoped = !!(row.collegeId as string);
          const isLocationScoped = !isCollegeScoped && !!(row.locationId as string);
          const canEdit = PHOTO_EDITABLE_ROLES.includes(row.role);
          // Faculty isn't Super-Admin-editable (their HOD/Principal owns that),
          // but Super Admin can still view the profile - same hub view PRINCIPAL/
          // DIRECTOR get, just without an Edit button (see [uid]/page.tsx's
          // HUB_ROLES and the module page's own read-only check for that role).
          const canView = row.role === "PANEL_MEMBER";
          const editHref = `/super-admin/users/${row.uid}?role=${row.role}` +
            (row.collegeId ? `&collegeId=${row.collegeId}` : "") +
            (row.locationId ? `&locationId=${row.locationId}` : "");
          // Never wraps to a second line - a college with a longer role label
          // (e.g. "Head of Department") had enough buttons here to wrap onto
          // two lines while a shorter-label college's row stayed on one, so
          // the action column's height varied row to row. Kept on one line
          // always now; if the row genuinely doesn't fit, the table's own
          // horizontal scroll (DataTable's existing responsive fallback, same
          // as every other list in this app) takes over instead of an
          // inconsistent wrap.
          return (
            <div className="flex items-center gap-1 whitespace-nowrap">
              {canEdit || canView ? (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(editHref); }}>
                  <Eye className="h-3.5 w-3.5" />
                  <span className="ml-1 hidden lg:inline">{row.role === "PRINCIPAL" || canView ? "View" : "Edit"}</span>
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setViewUser(row); }}>
                  <Eye className="h-3.5 w-3.5" />
                  <span className="ml-1 hidden lg:inline">View</span>
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
    ],
    [actionUid, downloadingResumeUid, router, ROLE_LABELS]
  );

  const collegeLabel = selectedCollegeId === GLOBAL_SCOPE
    ? "System-Wide Users"
    : selectedCollegeId.startsWith(LOCATION_PREFIX)
    ? locations.find((l) => l.id === selectedCollegeId.slice(LOCATION_PREFIX.length))?.name ?? "Location"
    : colleges.find((c) => c.id === selectedCollegeId)?.name ?? "All Users";

  const isCollegeScope = isCollegeScopedId(selectedCollegeId);
  const displayedUsers = useMemo(() => {
    if (!isCollegeScope) return users;
    if (!hasUsersLoaded) return [] as UserRow[];
    if (selectedDeptName === ALL_DEPTS) return users;
    if (selectedDeptName) {
      return users.filter((u) => {
        const depts = (u.departments as string[] | undefined) && (u.departments as string[]).length > 0
          ? (u.departments as string[])
          : ([u.department as string | undefined].filter(Boolean) as string[]);
        return depts.includes(selectedDeptName);
      });
    }
    return users;
  }, [users, hasUsersLoaded, selectedDeptName, isCollegeScope]);

  const isAllFilter = selectedDeptName === ALL_DEPTS;
  const deptEmptyTitle = hasUsersLoaded && isCollegeScope && selectedDeptName && displayedUsers.length === 0
    ? (isAllFilter ? `No users in ${collegeLabel}` : `No users in ${selectedDeptName}`)
    : selectedCollegeId === GLOBAL_SCOPE ? "No system-wide users" : `No users in ${collegeLabel}`;

  const deptEmptyDescription = hasUsersLoaded && isCollegeScope && selectedDeptName && displayedUsers.length === 0
    ? (isAllFilter ? `No accounts found in ${collegeLabel}` : `No accounts are assigned to ${selectedDeptName} in ${collegeLabel}`)
    : selectedCollegeId === GLOBAL_SCOPE ? "Create a Management account to see it here" : "Create the first user for this college";

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

      {isCollegeScope && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4 rounded-lg border bg-card p-4">
          <div className="flex flex-col gap-1.5 min-w-[220px]">
            <Label className="text-xs">Department</Label>
            <Select value={selectedDeptName} onValueChange={setSelectedDeptName} disabled={isDeptLoading}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={isDeptLoading ? "Loading..." : "Select department or ALL"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DEPTS}>ALL</SelectItem>
                {departmentsList.map((d) => (
                  <SelectItem key={d.id} value={d.name}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={!selectedDeptName}
              onClick={handleLoadUsers}
              loading={isLoading}
            >
              Load
            </Button>
            {hasUsersLoaded && (
              <Button variant="outline" size="sm" onClick={() => { setSelectedDeptName(""); setHasDeptLoaded(false); setHasUsersLoaded(false); setUsers([]); }}>Clear</Button>
            )}
          </div>
          {!hasUsersLoaded && (
            <span className="text-xs text-muted-foreground sm:ml-auto">Select a department (or ALL) and click Load</span>
          )}
          {hasUsersLoaded && selectedDeptName && (
            <span className="text-xs text-muted-foreground sm:ml-auto">
              {isAllFilter ? `Showing all ${displayedUsers.length} users` : `Showing ${displayedUsers.length} of ${users.length} users in ${selectedDeptName}`}
            </span>
          )}
        </div>
      )}

      {isCollegeScope && !hasUsersLoaded ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          Select a department (or <span className="font-medium">ALL</span>) and click <span className="font-medium">Load</span> to view users. Use search after loading.
        </div>
      ) : (
        <DataTable
          data={displayedUsers}
          columns={columns}
          isLoading={isLoading}
          keyExtractor={(r) => r.uid as string}
          paginate
          defaultPageSize={20}
          searchPlaceholder="Search users..."
          searchKeys={["name", "email", "department"] as (keyof UserRow)[]}
          emptyTitle={deptEmptyTitle}
          emptyDescription={deptEmptyDescription}
          emptyAction={
            <Button onClick={() => router.push("/super-admin/users/new")}>
              <UserPlus className="h-4 w-4 mr-2" />
              Add User
            </Button>
          }
          csvFilename="users"
        />
      )}

      {/* Read-only View Dialog - the fallback for roles with no profile hub/edit form (see viewUser above) */}
      <Dialog open={!!viewUser} onOpenChange={(open) => !open && setViewUser(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <Avatar name={facultyDisplayName(viewUser ?? {}) || (viewUser?.name as string)} photoUrl={viewUser?.profilePhotoUrl as string | undefined} size="sm" />
              {facultyDisplayName(viewUser ?? {}) || (viewUser?.name as string)}
            </DialogTitle>
          </DialogHeader>
          {viewUser && (
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Role</span>
                <Badge variant="outline">{ROLE_LABELS[viewUser.role as keyof typeof ROLE_LABELS] ?? viewUser.role}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={(viewUser.isActive as boolean) ? "default" : "secondary"}>
                  {(viewUser.isActive as boolean) ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span className="text-muted-foreground shrink-0">Email</span>
                <span className="text-right truncate">{viewUser.email as string}</span>
              </div>
              {!!viewUser.collegeEmail && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">College Email</span>
                  <span className="text-right truncate">{viewUser.collegeEmail as string}</span>
                </div>
              )}
              {!!viewUser.phone && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Phone</span>
                  <span>{viewUser.phone as string}</span>
                </div>
              )}
              {!!viewUser.employeeId && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Employee ID</span>
                  <span>{viewUser.employeeId as string}</span>
                </div>
              )}
              {!!viewUser.designation && (
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground shrink-0">Designation</span>
                  <span>{viewUser.designation as string}</span>
                </div>
              )}
              {(() => {
                const depts = viewUser.departments && (viewUser.departments as string[]).length > 0
                  ? (viewUser.departments as string[])
                  : [viewUser.department as string | undefined].filter(Boolean) as string[];
                return depts.length > 0 && (
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-muted-foreground shrink-0">Department{depts.length > 1 ? "s" : ""}</span>
                    <span className="text-right">{depts.join(", ")}</span>
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewUser(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              <Label htmlFor="reset-new-password">New Password</Label>
              <Input
                id="reset-new-password"
                name="reset-new-password"
                type="password"
                // Without this, a field this generic (no name/id/autocomplete
                // hint) is exactly what Chrome's password manager targets for
                // an autofill suggestion - and since it can't know this sets
                // *someone else's* password, it offers the one saved for this
                // origin under the currently logged-in Super Admin's own
                // account. "new-password" tells it this isn't a login field
                // at all, so it won't offer to fill anyone's saved password.
                autoComplete="new-password"
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
