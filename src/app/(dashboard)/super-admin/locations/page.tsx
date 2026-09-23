"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MobileCard } from "@/components/shared/MobileCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useMobile } from "@/hooks/useMobile";
import type { Location } from "@/types";

export default function LocationsPage() {
  const isMobile = useMobile();
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteLocation, setDeleteLocation] = useState<Location | null>(null);
  const [deleting, setDeleting] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => setLocations(d.locations ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load locations" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function toggleActive(loc: Location) {
    await fetch(`/api/admin/locations/${loc.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !loc.isActive }),
    });
    load();
  }

  async function handleDelete(loc: Location) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/locations/${loc.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to delete location");
      toast({ variant: "success", title: "Location deleted" });
      setDeleteLocation(null);
      load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to delete location",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Locations"
        description="Manage institution locations (Bhimavaram, Hyderabad, Naraspur…)"
        actions={
          <Button asChild>
            <Link href="/super-admin/locations/new">+ Add Location</Link>
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
              fields={[{ label: "State", value: loc.state ?? "-" }]}
              actions={
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/super-admin/locations/${loc.id}/edit`}>Edit</Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => void toggleActive(loc)}>
                    {loc.isActive ? "Deactivate" : "Reactivate"}
                  </Button>
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteLocation(loc)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
              render: (r) => {
                const loc = r as unknown as Location;
                return (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/super-admin/locations/${loc.id}/edit`}>Edit</Link>
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => void toggleActive(loc)}>
                      {loc.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); setDeleteLocation(loc); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!deleteLocation}
        onOpenChange={(open) => !open && setDeleteLocation(null)}
        title="Delete Location?"
        description={`This will permanently delete "${deleteLocation?.name}". This cannot be undone. The location must have no colleges or administrators before it can be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteLocation) void handleDelete(deleteLocation); }}
      />
    </div>
  );
}
