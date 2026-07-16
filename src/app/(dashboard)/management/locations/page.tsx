"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useMobile } from "@/hooks/useMobile";
import type { Location } from "@/types";

export default function ManagementLocationsPage() {
  const isMobile = useMobile();
  const [locations, setLocations] = useState<Location[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => setLocations(d.locations ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load locations" }))
      .finally(() => setIsLoading(false));
  }, []);

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
          ]}
        />
      )}
    </div>
  );
}
