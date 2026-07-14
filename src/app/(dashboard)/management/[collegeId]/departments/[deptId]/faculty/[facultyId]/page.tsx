"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
import { DESIGNATION_LABELS } from "@/types";
import type { FacultyMember } from "@/types";

export default function ManagementFacultyDetailPage() {
  const router = useRouter();
  const { collegeId, deptId, facultyId } = useParams<{ collegeId: string; deptId: string; facultyId: string }>();
  const [faculty, setFaculty] = useState<FacultyMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty/${facultyId}`)
      .then((r) => r.json() as Promise<{ faculty: FacultyMember }>)
      .then((d) => setFaculty(d.faculty ?? null))
      .finally(() => setIsLoading(false));
  }, [collegeId, deptId, facultyId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={faculty?.name ?? "Faculty Member"}
        description={faculty ? DESIGNATION_LABELS[faculty.designation] : undefined}
        actions={
          <Button variant="outline" onClick={() => router.push(`/management/${collegeId}/departments/${deptId}/faculty`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !faculty ? (
        <p className="text-sm text-muted-foreground">Faculty record not found.</p>
      ) : (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Employee ID</p><p className="text-sm font-medium">{faculty.employeeId}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{faculty.email}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{faculty.phone || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Department</p><p className="text-sm font-medium">{faculty.department}</p></div>
              <div><p className="text-xs text-muted-foreground">Designation</p><p className="text-sm font-medium">{DESIGNATION_LABELS[faculty.designation]}</p></div>
              <div><p className="text-xs text-muted-foreground">Qualification</p><p className="text-sm font-medium">{faculty.qualification || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Specialization</p><p className="text-sm font-medium">{faculty.specialization || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Experience (yrs)</p><p className="text-sm font-medium">{faculty.experienceYears}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
            <CardContent>
              <ProfileFieldsView profile={faculty.academicProfile} includeTeachingAssignment />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
