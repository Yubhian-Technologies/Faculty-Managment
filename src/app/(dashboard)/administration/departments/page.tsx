"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, PowerOff, Power, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { useMobile } from "@/hooks/useMobile";
import { useAuthStore } from "@/store/authStore";
import type { LocationDepartment } from "@/types";

export default function LocationDeptsPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const locationId = useAuthStore((s) => s.user?.locationId) ?? "";
  const [depts, setDepts] = useState<LocationDepartment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [confirmDept, setConfirmDept] = useState<{ dept: LocationDepartment; action: "deactivate" | "activate" | "delete" } | null>(null);

  function loadDepts() {
    setIsLoading(true);
    fetch("/api/location/departments")
      .then((r) => r.json() as Promise<{ departments: LocationDepartment[] }>)
      .then((d) => setDepts(d.departments ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadDepts(); }, []);

  async function handleToggleActive(dept: LocationDepartment, isActive: boolean) {
    setActionId(dept.id);
    try {
      const res = await fetch(`/api/location/departments/${dept.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, isActive }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: isActive ? "Department activated" : "Department deactivated" });
      setDepts((prev) => prev.map((d) => d.id === dept.id ? { ...d, isActive } : d));
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setActionId(null);
      setConfirmDept(null);
    }
  }

  async function handleDelete(dept: LocationDepartment) {
    setActionId(dept.id);
    try {
      const res = await fetch(`/api/location/departments/${dept.id}?locationId=${locationId}`, { method: "DELETE" });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed");
      toast({ variant: "success", title: "Department deleted" });
      setDepts((prev) => prev.filter((d) => d.id !== dept.id));
    } catch (err) {
      toast({
        variant: "destructive",
        title: `Couldn't delete ${dept.name}`,
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setActionId(null);
      setConfirmDept(null);
    }
  }

  // Always icon + text - the desktop branch below only ever renders on a
  // wide-enough viewport (useMobile() swaps to MobileCard below that), same
  // reasoning as Location Staff's own action buttons.
  function actionButtons(d: LocationDepartment) {
    return (
      <>
        <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/administration/departments/${d.id}/edit`); }}>
          <Pencil className="h-3.5 w-3.5 mr-1" />
          Edit
        </Button>
        {d.isActive ? (
          <Button
            variant="ghost"
            size="sm"
            loading={actionId === d.id}
            onClick={(e) => { e.stopPropagation(); setConfirmDept({ dept: d, action: "deactivate" }); }}
          >
            <PowerOff className="h-3.5 w-3.5 mr-1 text-destructive" />
            <span className="text-destructive">Deactivate</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            loading={actionId === d.id}
            onClick={(e) => { e.stopPropagation(); setConfirmDept({ dept: d, action: "activate" }); }}
          >
            <Power className="h-3.5 w-3.5 mr-1 text-green-600" />
            <span className="text-green-600">Activate</span>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          loading={actionId === d.id}
          onClick={(e) => { e.stopPropagation(); setConfirmDept({ dept: d, action: "delete" }); }}
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
        title="Location Departments"
        description="Manage Electrical, Civil, Accounts and other administrative departments"
        actions={
          <Button asChild>
            <Link href="/administration/departments/new">+ Add Department</Link>
          </Button>
        }
      />

      {isMobile ? (
        <div className="space-y-3">
          {depts.map((d) => (
            <MobileCard
              key={d.id}
              title={d.name}
              subtitle={d.deptHeadName ?? "No dept head assigned"}
              badge={<Badge variant={d.isActive ? "default" : "secondary"}>{d.isActive ? "Active" : "Inactive"}</Badge>}
              fields={[{ label: "Dept Head", value: d.deptHeadName ?? "-" }]}
              actions={actionButtons(d)}
              onClick={() => router.push(`/administration/departments/${d.id}`)}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={depts as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search departments..."
          searchKeys={["name"]}
          csvFilename="location-depts"
          onRowClick={(r) => router.push(`/administration/departments/${(r as unknown as LocationDepartment).id}`)}
          columns={[
            { key: "name", header: "Department" },
            { key: "deptHeadName", header: "Dept Head", render: (r) => (r as unknown as LocationDepartment).deptHeadName ?? <span className="text-muted-foreground italic">Not assigned</span> },
            {
              key: "isActive", header: "Status",
              render: (r) => <Badge variant={(r as unknown as LocationDepartment).isActive ? "default" : "secondary"}>{(r as unknown as LocationDepartment).isActive ? "Active" : "Inactive"}</Badge>,
            },
            {
              // Shrink-to-fit, same fix as Location Staff's own actions column -
              // otherwise a header-less column absorbs the table's leftover width.
              key: "actions", header: "", className: "w-px",
              render: (r) => <div className="flex items-center gap-1 whitespace-nowrap">{actionButtons(r as unknown as LocationDepartment)}</div>,
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!confirmDept}
        onOpenChange={(open) => !open && setConfirmDept(null)}
        title={
          confirmDept?.action === "delete"
            ? "Delete Department?"
            : confirmDept?.action === "activate"
            ? "Activate Department?"
            : "Deactivate Department?"
        }
        description={
          confirmDept?.action === "delete"
            ? `Permanently delete "${confirmDept?.dept?.name}"? This can't be undone.`
            : confirmDept?.action === "activate"
            ? `Make "${confirmDept?.dept?.name}" available again?`
            : `Mark "${confirmDept?.dept?.name}" as inactive? This can be reversed later.`
        }
        confirmLabel={
          confirmDept?.action === "delete"
            ? "Delete"
            : confirmDept?.action === "activate"
            ? "Activate"
            : "Deactivate"
        }
        variant={confirmDept?.action === "activate" ? "default" : "destructive"}
        loading={actionId === confirmDept?.dept?.id}
        onConfirm={() => {
          if (!confirmDept) return;
          if (confirmDept.action === "delete") void handleDelete(confirmDept.dept);
          else void handleToggleActive(confirmDept.dept, confirmDept.action === "activate");
        }}
      />
    </div>
  );
}
