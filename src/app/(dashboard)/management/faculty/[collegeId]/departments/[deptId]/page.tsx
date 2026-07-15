"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ChevronDown, ChevronUp, User, IdCard, GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { Avatar } from "@/components/shared/Avatar";
import type { FacultyMember, FMSUser, FacultyProfileFields } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;
type HodProfile = FMSUser & { academicProfile?: FacultyProfileFields };

export default function ManagementDepartmentFacultyPage() {
  const router = useRouter();
  const { collegeId, deptId } = useParams<{ collegeId: string; deptId: string }>();
  const [showHodDetails, setShowHodDetails] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["mgmt-dept-faculty", collegeId, deptId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty`).then(
        (r) => r.json() as Promise<{ faculty: FacultyRow[]; collegeName: string; hod: HodProfile | null }>
      ),
  });

  const faculty = data?.faculty ?? [];
  const collegeName = data?.collegeName ?? "";
  const hod = data?.hod ?? null;

  const columns: Column<FacultyRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name} photoUrl={row.profilePhotoUrl} size="sm" />
          <span>{row.name}</span>
        </div>
      ),
    },
    { key: "college", header: "College", render: () => <span>{collegeName}</span> },
    { key: "department", header: "Department" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty"
        description="Faculty members in this department"
        actions={
          <Button variant="outline" onClick={() => router.push(`/management/faculty/${collegeId}/departments`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {hod && (
        <Card className="border-l-4 border-l-amber-500 shadow-md hover:shadow-lg transition-shadow duration-200 bg-amber-50/40">
          <CardContent
            className="p-4 flex items-center justify-between gap-3 cursor-pointer select-none"
            onClick={() => setShowHodDetails((v) => !v)}
          >
            <div className="flex items-center gap-3">
              <Avatar name={hod.name} photoUrl={hod.profilePhotoUrl} size="md" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-medium">{hod.name}</p>
                  <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">HOD</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{hod.email}{hod.phone ? ` · ${hod.phone}` : ""}</p>
              </div>
            </div>
            {showHodDetails ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </CardContent>

          {showHodDetails && (
            <CardContent className="pt-0 space-y-4 border-t bg-background/60">
              <div className="rounded-lg border bg-muted/20 shadow-sm p-3 mt-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-blue-600">
                    <User className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-sm font-semibold">Identity</p>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Employee ID</p><p className="text-sm font-medium">{hod.employeeId || "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Designation</p><p className="text-sm font-medium">{hod.designation || "—"}</p></div>
                  <div><p className="text-xs text-muted-foreground">Department</p><p className="text-sm font-medium">{hod.department || "—"}</p></div>
                </div>
              </div>

              <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-50 text-violet-600">
                    <IdCard className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-sm font-semibold">Personal Details</p>
                </div>
                <PersonalDetailsView value={hod} />
              </div>

              <div className="rounded-lg border bg-muted/20 shadow-sm p-3">
                <div className="flex items-center gap-2 mb-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-50 text-emerald-600">
                    <GraduationCap className="h-3.5 w-3.5" />
                  </span>
                  <p className="text-sm font-semibold">Academic Profile</p>
                </div>
                <ProfileFieldsView profile={hod.academicProfile} includeTeachingAssignment />
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <DataTable
        data={faculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(f) => f.id}
        searchPlaceholder="Search faculty..."
        searchKeys={["name"] as (keyof FacultyMember)[]}
        emptyTitle="No faculty in this department"
        onRowClick={(f) => router.push(`/management/faculty/${collegeId}/departments/${deptId}/faculty/${f.id}`)}
      />
    </div>
  );
}
