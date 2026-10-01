"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, UserPlus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { PeopleNotOnRoster } from "@/components/roles/PeopleNotOnRoster";
import { EmptyState } from "@/components/shared/EmptyState";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { useCollegeType } from "@/hooks/useCollegeType";
import { hasSupportingStaffSplit } from "@/lib/designations/config";
import type { Department, FacultyMember } from "@/types";

export default function PrincipalFacultyDepartmentsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { collegeType, loading: collegeTypeLoading } = useCollegeType();

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

  // A department split into sub-departments (e.g. Basic Science ->
  // BSC/BSM/BSP/BSE) shouldn't appear as flat, separate top-level cards next
  // to real departments - each child is only ever reached through its parent
  // (principal/faculty/[deptId]/page.tsx lists them once you're inside).
  const topLevelDepartments = departments.filter((d) => !d.parentDepartmentId);
  const childCount = (parentId: string) => departments.filter((d) => d.parentDepartmentId === parentId).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty"
        description="Select a department to view its faculty"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/principal/faculty/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Button onClick={() => router.push("/principal/faculty/new")}><UserPlus className="h-4 w-4 mr-2" />Add Faculty</Button>
          </div>
        }
      />

      {/* Only colleges that keep supporting staff separate get this tab; the
          Supporting Staff view is read-only for Principal / College Admin. */}
      {!collegeTypeLoading && hasSupportingStaffSplit(collegeType) && (
        <SegmentedTabs
          value="faculty"
          options={[
            { key: "faculty", label: "Teaching Faculty", href: "/principal/faculty" },
            { key: "supporting", label: "Supporting Staff", href: "/principal/faculty/supporting-staff" },
          ]}
        />
      )}

      <PeopleNotOnRoster departments={departments} />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-[72px] rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : topLevelDepartments.length === 0 ? (
        <EmptyState
          title="No departments yet"
          description="Departments added under Academic Management will appear here."
          icon={<BookOpen className="h-8 w-8" />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topLevelDepartments.map((d) => {
            const subCount = childCount(d.id);
            return (
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
                      <p className={`text-xs mt-0.5 ${d.hodName ? "text-muted-foreground" : "text-orange-500"}`}>
                        {d.hodName ? `HOD: ${d.hodName}` : "No HOD assigned"}
                      </p>
                      {subCount > 0 && (
                        <p className="text-xs mt-0.5 text-primary">{subCount} sub-department{subCount !== 1 ? "s" : ""}</p>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
