"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, UserX, UserCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { FMSUser, Location } from "@/types";

type UserRow = Record<string, unknown> & FMSUser;

export default function ManagementUsersPage() {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [users, setUsers] = useState<UserRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionUid, setActionUid] = useState<string | null>(null);
  const [confirmUser, setConfirmUser] = useState<{ user: UserRow; action: "deactivate" | "activate" } | null>(null);

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((data) => {
        const l = data.locations ?? [];
        setLocations(l);
        if (l.length > 0) setSelectedLocationId(l[0].id);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load locations" }));
  }, []);

  useEffect(() => {
    if (!selectedLocationId) return;
    setIsLoading(true);
    fetch(`/api/location/users?locationId=${selectedLocationId}`)
      .then((r) => r.json() as Promise<{ users: UserRow[] }>)
      .then((d) => setUsers(d.users ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load administrators" }))
      .finally(() => setIsLoading(false));
  }, [selectedLocationId]);

  async function handleToggleActive(user: UserRow, isActive: boolean) {
    setActionUid(user.uid);
    try {
      const res = await fetch(`/api/location/users/${user.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: selectedLocationId, isActive }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: isActive ? "Administrator activated" : "Administrator deactivated" });
      setUsers((prev) => prev.map((u) => (u.uid === user.uid ? { ...u, isActive } : u)));
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setActionUid(null);
      setConfirmUser(null);
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name as string}</p>
          <p className="text-xs text-muted-foreground">{row.email as string}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (row) => (
        <Badge variant="outline">{ROLE_LABELS[row.role as keyof typeof ROLE_LABELS] ?? (row.role as string)}</Badge>
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
      render: (row) =>
        (row.isActive as boolean) ? (
          <Button
            variant="ghost"
            size="sm"
            loading={actionUid === (row.uid as string)}
            onClick={() => setConfirmUser({ user: row, action: "deactivate" })}
          >
            <UserX className="h-3.5 w-3.5 text-destructive" />
            <span className="ml-1 hidden lg:inline text-destructive">Deactivate</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            loading={actionUid === (row.uid as string)}
            onClick={() => setConfirmUser({ user: row, action: "activate" })}
          >
            <UserCheck className="h-3.5 w-3.5 text-green-600" />
            <span className="ml-1 hidden lg:inline text-green-600">Activate</span>
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Administrators"
        description="Location-wise Administrators and Accounts contacts you've appointed"
        actions={
          <Button onClick={() => router.push("/management/users/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Administrator
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
                onClick={() => setSelectedLocationId(l.id)}
                className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                  selectedLocationId === l.id
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
        searchPlaceholder="Search administrators..."
        searchKeys={["name", "email"] as (keyof UserRow)[]}
        emptyTitle="No administrators for this location"
        emptyDescription="Add an Administrator or Accounts contact to see them here"
        emptyAction={
          <Button onClick={() => router.push("/management/users/new")}>
            <UserPlus className="h-4 w-4 mr-2" />
            Add Administrator
          </Button>
        }
        csvFilename="administrators"
      />

      <ConfirmDialog
        open={!!confirmUser}
        onOpenChange={(open) => !open && setConfirmUser(null)}
        title={confirmUser?.action === "activate" ? "Activate Administrator?" : "Deactivate Administrator?"}
        description={
          confirmUser?.action === "activate"
            ? `Allow ${confirmUser?.user?.name as string} to log in again?`
            : `Block ${confirmUser?.user?.name as string} from logging in? Their data is preserved.`
        }
        confirmLabel={confirmUser?.action === "activate" ? "Activate" : "Deactivate"}
        variant={confirmUser?.action === "activate" ? "default" : "destructive"}
        loading={actionUid === confirmUser?.user?.uid}
        onConfirm={() => {
          if (!confirmUser) return;
          void handleToggleActive(confirmUser.user, confirmUser.action === "activate");
        }}
      />
    </div>
  );
}
