"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import type { College } from "@/types";

export default function ManagementCollegesPage() {
  const router = useRouter();
  const [colleges, setColleges] = useState<College[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/management/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges(d.colleges ?? []))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title="Colleges" description="Select a college to view its institutional profile" />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : colleges.length === 0 ? (
        <p className="text-sm text-muted-foreground">No colleges found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {colleges.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer hover:border-primary transition-colors"
              onClick={() => router.push(`/management/${c.id}`)}
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
