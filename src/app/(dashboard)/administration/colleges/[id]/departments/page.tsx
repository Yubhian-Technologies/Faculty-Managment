"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { BookOpen, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Department } from "@/types";

export default function AdministrationCollegeDepartmentsPage() {
  const router = useRouter();
  const { id: collegeId } = useParams<{ id: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["admin-college-departments", collegeId],
    queryFn: () =>
      fetch(`/api/administration/colleges/${collegeId}/departments`).then(
        (r) => r.json() as Promise<{ departments?: Department[]; collegeName?: string }>
      ),
  });
  const departments = data?.departments ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={data?.collegeName ? `${data.collegeName} - Departments` : "Departments"}
        description="Select a department to view its faculty"
        actions={
          <Button variant="outline" onClick={() => router.push("/administration/colleges")}>
            <ArrowLeft className="h-4 w-4 mr-2" />All Colleges
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No departments found.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <Card
              key={d.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
              onClick={() => router.push(`/administration/colleges/${collegeId}/departments/${d.id}`)}
            >
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <BookOpen className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.code}</p>
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
