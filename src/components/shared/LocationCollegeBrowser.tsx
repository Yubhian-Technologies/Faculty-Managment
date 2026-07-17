"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MapPin, Building2, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { College, Location } from "@/types";

// Shared Location → College drill-down shell used by both Purchase Dept
// (/purchase/browse) and Finance (/finance/browse) — both are GLOBAL roles
// serving every college across every location, so both need the same
// "pick a location, then a college" entry point before landing on a
// role-specific college-level view (department/category/type breakdown,
// which differs between indents and budget requests and stays owned by
// each role's own [locationId]/[collegeId] page).

interface LocationBrowserListProps {
  basePath: string; // e.g. "/purchase/browse" or "/finance/browse"
  description?: string;
}

export function LocationBrowserList({ basePath, description = "Select a location to see its colleges" }: LocationBrowserListProps) {
  const router = useRouter();
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
      <PageHeader title="Browse by Location" description={description} />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : locations.length === 0 ? (
        <EmptyState title="No locations found" icon={<MapPin className="h-8 w-8" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {locations.map((loc) => (
            <Card
              key={loc.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all"
              onClick={() => router.push(`${basePath}/${loc.id}`)}
            >
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <MapPin className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{loc.name}</p>
                    <p className="text-xs text-muted-foreground">{loc.city}{loc.state ? `, ${loc.state}` : ""}</p>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

interface CollegeBrowserListProps {
  basePath: string;
  description?: string;
}

export function CollegeBrowserList({ basePath, description = "Select a college to see its departments" }: CollegeBrowserListProps) {
  const router = useRouter();
  const params = useParams<{ locationId: string }>();
  const [location, setLocation] = useState<Location | null>(null);
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch("/api/admin/locations").then((r) => r.json() as Promise<{ locations: Location[] }>).then((d) => d.locations ?? []),
      fetch(`/api/admin/colleges?locationId=${params.locationId}`).then((r) => r.json() as Promise<{ colleges: College[] }>).then((d) => d.colleges ?? []),
    ])
      .then(([locations, colleges]) => {
        setLocation(locations.find((l) => l.id === params.locationId) ?? null);
        setColleges(colleges);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load colleges" }))
      .finally(() => setIsLoading(false));
  }, [params.locationId]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={basePath}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title={location?.name ?? "Colleges"} description={description} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : colleges.length === 0 ? (
        <EmptyState title="No colleges in this location" icon={<Building2 className="h-8 w-8" />} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {colleges.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all"
              onClick={() => router.push(`${basePath}/${params.locationId}/${c.id}`)}
            >
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{c.name}</p>
                    {c.address && <p className="text-xs text-muted-foreground">{c.address}</p>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
