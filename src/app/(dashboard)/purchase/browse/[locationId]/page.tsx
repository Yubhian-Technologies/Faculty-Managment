"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Building2, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { College, Location } from "@/types";

export default function PurchaseBrowseCollegesPage() {
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
          <Link href="/purchase/browse"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title={location?.name ?? "Colleges"} description="Select a college to see its departments" />
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
              onClick={() => router.push(`/purchase/browse/${params.locationId}/${c.id}`)}
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
