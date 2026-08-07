"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { History, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Department } from "@/types";

export default function PrincipalLeaveHistoryDepartmentsPage() {
  const router = useRouter();

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["principal-leave-history-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Leave History" description="Select a department to view its leave register" />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-[72px] rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : departments.length === 0 ? (
        <EmptyState
          title="No departments yet"
          description="Departments added under Academic Management will appear here."
          icon={<History className="h-8 w-8" />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <Card
              key={d.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
              onClick={() => router.push(`/principal/leave-history/${d.id}`)}
            >
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <History className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.code}</p>
                    <p className={`text-xs mt-0.5 ${d.hodName ? "text-muted-foreground" : "text-orange-500"}`}>
                      {d.hodName ? `HOD: ${d.hodName}` : "No HOD assigned"}
                    </p>
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
