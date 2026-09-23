"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";

interface BrowseFaculty {
  id: string;
  name: string;
  email: string;
  designation: string;
  employeeId: string;
  status: string;
}

interface BrowseStudent {
  id: string;
  name: string;
  rollNumber: string;
  year: number | null;
  section: string;
  status: string;
  email: string;
}

// Read-only lookup: Location Admin can search this department's faculty and
// students to confirm someone exists/is active here, but not open or edit
// their full profile - that stays with the college's own HOD/Principal. See
// the college-browse API routes' own comments for why this is a separate,
// purpose-built read path rather than the HOD-facing faculty/student lists.
export default function CollegeDepartmentBrowsePage() {
  const params = useParams<{ id: string; deptId: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const collegeId = params.id;
  const departmentName = searchParams.get("name") ?? "";

  const [faculty, setFaculty] = useState<BrowseFaculty[]>([]);
  const [students, setStudents] = useState<BrowseStudent[]>([]);
  const [loadingFaculty, setLoadingFaculty] = useState(true);
  const [loadingStudents, setLoadingStudents] = useState(true);

  useEffect(() => {
    if (!departmentName) {
      toast({ variant: "destructive", title: "Missing department context" });
      router.push(`/administration/colleges/${collegeId}/departments`);
      return;
    }
    const qs = `collegeId=${collegeId}&department=${encodeURIComponent(departmentName)}`;

    fetch(`/api/location/college-browse/faculty?${qs}`)
      .then((r) => r.json() as Promise<{ faculty?: BrowseFaculty[]; error?: string }>)
      .then((d) => {
        if (d.error) { toast({ variant: "destructive", title: d.error }); return; }
        setFaculty(d.faculty ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty" }))
      .finally(() => setLoadingFaculty(false));

    fetch(`/api/location/college-browse/students?${qs}`)
      .then((r) => r.json() as Promise<{ students?: BrowseStudent[]; error?: string }>)
      .then((d) => {
        if (d.error) { toast({ variant: "destructive", title: d.error }); return; }
        setStudents(d.students ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load students" }))
      .finally(() => setLoadingStudents(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collegeId, departmentName]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/administration/colleges/${collegeId}/departments`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title={departmentName || "Department"} description="Search faculty or students in this department" />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Search Faculty</CardTitle></CardHeader>
        <CardContent>
          <DataTable<Record<string, unknown>>
            data={faculty as unknown as Record<string, unknown>[]}
            keyExtractor={(r) => r.id as string}
            isLoading={loadingFaculty}
            paginate
            defaultPageSize={10}
            searchPlaceholder="Search faculty by name, email or employee ID..."
            searchKeys={["name", "email", "employeeId"]}
            emptyTitle="No faculty in this department"
            columns={[
              { key: "name", header: "Name" },
              { key: "email", header: "Email" },
              { key: "designation", header: "Designation" },
              { key: "employeeId", header: "Employee ID" },
              {
                key: "status", header: "Status",
                render: (r) => <Badge variant={(r as unknown as BrowseFaculty).status === "ACTIVE" ? "default" : "secondary"}>{(r as unknown as BrowseFaculty).status}</Badge>,
              },
            ]}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Search Students</CardTitle></CardHeader>
        <CardContent>
          <DataTable<Record<string, unknown>>
            data={students as unknown as Record<string, unknown>[]}
            keyExtractor={(r) => r.id as string}
            isLoading={loadingStudents}
            paginate
            defaultPageSize={10}
            searchPlaceholder="Search students by name or roll number..."
            searchKeys={["name", "rollNumber", "email"]}
            emptyTitle="No students in this department"
            columns={[
              { key: "name", header: "Name" },
              { key: "rollNumber", header: "Roll Number" },
              { key: "year", header: "Year", render: (r) => (r as unknown as BrowseStudent).year ?? "-" },
              { key: "section", header: "Section" },
              {
                key: "status", header: "Status",
                render: (r) => <Badge variant="outline">{(r as unknown as BrowseStudent).status || "-"}</Badge>,
              },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
