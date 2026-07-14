"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Building2, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import type { College } from "@/types";

interface Props {
  title: string;
  description: string;
  basePath: string;
}

async function fetchColleges(): Promise<College[]> {
  const r = await fetch("/api/management/colleges");
  const d = (await r.json()) as { colleges: College[] };
  return d.colleges ?? [];
}

export function CollegesListView({ title, description, basePath }: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: colleges = [], isLoading } = useQuery({
    queryKey: ["mgmt-colleges"],
    queryFn: fetchColleges,
  });

  function prefetchCollege(collegeId: string) {
    queryClient.prefetchQuery({
      queryKey: ["mgmt-college", collegeId],
      queryFn: () =>
        fetch(`/api/management/colleges/${collegeId}`)
          .then((r) => r.json() as Promise<{ college: College }>)
          .then((d) => d.college ?? null),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : colleges.length === 0 ? (
        <p className="text-sm text-muted-foreground">No colleges found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {colleges.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
              onMouseEnter={() => prefetchCollege(c.id)}
              onClick={() => router.push(`${basePath}/${c.id}`)}
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
