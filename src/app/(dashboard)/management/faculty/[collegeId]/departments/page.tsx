"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { BookOpen, ChevronRight, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { Department, FacultyMember, FMSUser } from "@/types";

export default function ManagementDepartmentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { collegeId } = useParams<{ collegeId: string }>();

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["mgmt-departments", collegeId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments`)
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });

  function prefetchDeptFaculty(deptId: string) {
    queryClient.prefetchQuery({
      queryKey: ["mgmt-dept-faculty", collegeId, deptId],
      queryFn: () =>
        fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty`).then(
          (r) => r.json() as Promise<{ faculty: FacultyMember[]; collegeName: string; hod: FMSUser | null }>
        ),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description="Select a department to view its faculty"
        actions={
          <Button variant="outline" onClick={() => router.push(`/management/faculty/${collegeId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
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
              onMouseEnter={() => prefetchDeptFaculty(d.id)}
              onClick={() => router.push(`/management/faculty/${collegeId}/departments/${d.id}`)}
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
