"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import type { College, FacultyMember } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

export default function ManagementFacultyListPage() {
  const router = useRouter();
  const { collegeId, deptId } = useParams<{ collegeId: string; deptId: string }>();
  const [faculty, setFaculty] = useState<FacultyRow[]>([]);
  const [collegeName, setCollegeName] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty`)
      .then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>)
      .then((d) => setFaculty(d.faculty ?? []))
      .finally(() => setIsLoading(false));

    fetch("/api/management/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setCollegeName((d.colleges ?? []).find((c) => c.id === collegeId)?.name ?? ""));
  }, [collegeId, deptId]);

  const columns: Column<FacultyRow>[] = [
    { key: "name", header: "Name" },
    { key: "college", header: "College", render: () => <span>{collegeName}</span> },
    { key: "department", header: "Department" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty"
        description="Select a faculty member to view their full profile"
        actions={
          <Button variant="outline" onClick={() => router.push(`/management/${collegeId}/departments/${deptId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <DataTable
        data={faculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(f) => f.id}
        searchPlaceholder="Search faculty..."
        searchKeys={["name"] as (keyof FacultyMember)[]}
        emptyTitle="No faculty in this department"
        onRowClick={(f) => router.push(`/management/${collegeId}/departments/${deptId}/faculty/${f.id}`)}
      />
    </div>
  );
}
