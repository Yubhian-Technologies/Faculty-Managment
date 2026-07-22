"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { useMobile } from "@/hooks/useMobile";
import type { Location } from "@/types";

export default function ManagementLocationsPage() {
  const isMobile = useMobile();
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => setLocations(d.locations ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load locations" }))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/admin/locations/${deleteTarget.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete location");
      setLocations((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      toast({ variant: "success", title: "Location deleted" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to delete location" });
    } finally {
      setIsDeleting(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description="Campuses under the organization"
        actions={
          <Button asChild>
            <Link href="/management/locations/new">+ Add Location</Link>
          </Button>
        }
      />

      {isMobile ? (
        <div className="space-y-3">
          {locations.map((loc) => (
            <MobileCard
              key={loc.id}
              title={loc.name}
              subtitle={loc.city}
              badge={<Badge variant={loc.isActive ? "default" : "secondary"}>{loc.isActive ? "Active" : "Inactive"}</Badge>}
              fields={[{ label: "State", value: loc.state ?? "—" }]}
              actions={
                <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(loc)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  <span className="ml-1 text-destructive">Delete</span>
                </Button>
              }
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={locations as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search locations..."
          searchKeys={["name", "city"]}
          csvFilename="locations"
          columns={[
            { key: "name", header: "Location Name" },
            { key: "city", header: "City" },
            { key: "state", header: "State" },
            {
              key: "isActive",
              header: "Status",
              render: (r) => (
                <Badge variant={(r as unknown as Location).isActive ? "default" : "secondary"}>
                  {(r as unknown as Location).isActive ? "Active" : "Inactive"}
                </Badge>
              ),
            },
            {
              key: "actions",
              header: "",
              render: (r) => (
                <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(r as unknown as Location)}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              ),
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Location?"
        description={`This will permanently delete "${deleteTarget?.name}". This cannot be undone. Locations with existing colleges or administrators can't be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={isDeleting}
        onConfirm={handleDelete}
      />
    </div>
  );
}
