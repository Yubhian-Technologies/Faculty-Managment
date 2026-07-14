"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Plus, ToggleLeft, ToggleRight, Pencil, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";

type CollegeRow = {
  id: string;
  name: string;
  locationId?: string;
  locationName?: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  isActive: boolean;
  [key: string]: unknown;
};

export default function CollegesPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<CollegeRow[]>([]);
  const [locationMap, setLocationMap] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmCollege, setConfirmCollege] = useState<CollegeRow | null>(null);
  const [deleteCollege, setDeleteCollege] = useState<CollegeRow | null>(null);
  const [editCollege, setEditCollege] = useState<CollegeRow | null>(null);
  const [editForm, setEditForm] = useState({ name: "", address: "", contactEmail: "", contactPhone: "" });

  async function load() {
    setIsLoading(true);
    try {
      const [collegesRes, locationsRes] = await Promise.all([
        fetch("/api/admin/colleges"),
        fetch("/api/admin/locations"),
      ]);
      const collegesData = await collegesRes.json() as { colleges: CollegeRow[] };
      const locationsData = await locationsRes.json() as { locations: { id: string; name: string }[] };

      const map: Record<string, string> = {};
      for (const l of locationsData.locations ?? []) map[l.id] = l.name;
      setLocationMap(map);
      setColleges(collegesData.colleges ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load colleges" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function openEdit(college: CollegeRow) {
    setEditCollege(college);
    setEditForm({
      name: college.name,
      address: college.address ?? "",
      contactEmail: college.contactEmail ?? "",
      contactPhone: college.contactPhone ?? "",
    });
  }

  async function handleSaveEdit() {
    if (!editCollege) return;
    if (!editForm.name.trim()) {
      toast({ variant: "destructive", title: "College name is required" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId: editCollege.id, ...editForm }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "College updated" });
      setEditCollege(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update college" });
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(college: CollegeRow) {
    setToggling(college.id);
    try {
      const res = await fetch("/api/admin/colleges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId: college.id, isActive: !college.isActive }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `College ${college.isActive ? "deactivated" : "activated"}` });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update college" });
    } finally {
      setToggling(null);
      setConfirmCollege(null);
    }
  }

  async function handleDelete(college: CollegeRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/colleges?collegeId=${college.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to delete college");
      toast({ variant: "success", title: "College deleted" });
      setDeleteCollege(null);
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to delete college",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  const columns: Column<CollegeRow>[] = [
    {
      key: "name",
      header: "College",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.id}</p>
        </div>
      ),
    },
    {
      key: "locationId",
      header: "Location",
      render: (row) => (
        <Badge variant="outline" className="text-xs font-normal">
          {row.locationId ? (locationMap[row.locationId] ?? row.locationId) : <span className="text-muted-foreground italic">Unassigned</span>}
        </Badge>
      ),
    },
    {
      key: "contactEmail",
      header: "Contact",
      hideOnMobile: true,
      render: (row) => (
        <div>
          <p className="text-sm">{row.contactEmail || "—"}</p>
          <p className="text-xs text-muted-foreground">{row.contactPhone || ""}</p>
        </div>
      ),
    },
    {
      key: "address",
      header: "Address",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.address || "—"}</span>,
    },
    {
      key: "isActive",
      header: "Status",
      render: (row) => (
        <Badge variant={row.isActive ? "default" : "secondary"}>
          {row.isActive ? "Active" : "Inactive"}
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
            onClick={(e) => { e.stopPropagation(); openEdit(row); }}
          >
            <Pencil className="h-4 w-4" />
            <span className="ml-1 hidden sm:inline">Edit</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={toggling === row.id}
            onClick={(e) => { e.stopPropagation(); setConfirmCollege(row); }}
          >
            {row.isActive ? (
              <ToggleRight className="h-4 w-4 text-green-600" />
            ) : (
              <ToggleLeft className="h-4 w-4 text-muted-foreground" />
            )}
            <span className="ml-1 hidden sm:inline">
              {row.isActive ? "Deactivate" : "Activate"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); setDeleteCollege(row); }}
          >
            <Trash2 className="h-4 w-4" />
            <span className="ml-1 hidden sm:inline">Delete</span>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Colleges"
        description="Manage all institutions in the system"
        actions={
          <Button onClick={() => router.push("/super-admin/colleges/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Add College
          </Button>
        }
      />

      <DataTable
        data={colleges}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search colleges..."
        searchKeys={["name", "contactEmail", "address"] as (keyof CollegeRow)[]}
        emptyTitle="No colleges yet"
        emptyDescription="Add your first institution to get started"
        emptyAction={
          <Button onClick={() => router.push("/super-admin/colleges/new")}>
            <Building2 className="h-4 w-4 mr-2" />
            Add College
          </Button>
        }
        csvFilename="colleges"
      />

      {/* Edit Dialog */}
      <Dialog open={!!editCollege} onOpenChange={(open) => !open && setEditCollege(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Edit College</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">College Name *</Label>
              <Input
                id="edit-name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="College name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-address">Address</Label>
              <Input
                id="edit-address"
                value={editForm.address}
                onChange={(e) => setEditForm((f) => ({ ...f, address: e.target.value }))}
                placeholder="City, State"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="edit-email">Contact Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={editForm.contactEmail}
                  onChange={(e) => setEditForm((f) => ({ ...f, contactEmail: e.target.value }))}
                  placeholder="admin@college.edu"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-phone">Contact Phone</Label>
                <Input
                  id="edit-phone"
                  value={editForm.contactPhone}
                  onChange={(e) => setEditForm((f) => ({ ...f, contactPhone: e.target.value }))}
                  placeholder="+91 98765 43210"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCollege(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveEdit} loading={saving}>
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Toggle Confirm Dialog */}
      <ConfirmDialog
        open={!!confirmCollege}
        onOpenChange={(open) => !open && setConfirmCollege(null)}
        title={confirmCollege?.isActive ? "Deactivate College?" : "Activate College?"}
        description={
          confirmCollege?.isActive
            ? `Deactivating "${confirmCollege?.name}" will prevent all its users from logging in.`
            : `Activate "${confirmCollege?.name}" to allow its users to log in.`
        }
        confirmLabel={confirmCollege?.isActive ? "Deactivate" : "Activate"}
        variant={confirmCollege?.isActive ? "destructive" : "default"}
        onConfirm={() => { if (confirmCollege) void toggleActive(confirmCollege); }}
      />

      {/* Delete Confirm Dialog */}
      <ConfirmDialog
        open={!!deleteCollege}
        onOpenChange={(open) => !open && setDeleteCollege(null)}
        title="Delete College?"
        description={`This will permanently delete "${deleteCollege?.name}". This cannot be undone. The college must have no users before it can be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteCollege) void handleDelete(deleteCollege); }}
      />
    </div>
  );
}
