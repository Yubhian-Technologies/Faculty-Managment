"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import type { Department, FacultyMember } from "@/types";

export default function PrincipalFacultyDepartmentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["principal-faculty-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });

  function prefetchDeptFaculty(deptName: string) {
    queryClient.prefetchQuery({
      queryKey: ["principal-dept-faculty", deptName],
      queryFn: () =>
        fetch(`/api/college/faculty?department=${encodeURIComponent(deptName)}`).then(
          (r) => r.json() as Promise<{ faculty: FacultyMember[] }>
        ),
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Faculty" description="Select a department to view its faculty" />

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
          icon={<BookOpen className="h-8 w-8" />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((d) => (
            <Card
              key={d.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
              onMouseEnter={() => prefetchDeptFaculty(d.name)}
              onClick={() => router.push(`/principal/faculty/${d.id}`)}
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
