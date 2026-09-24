"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar } from "@/components/shared/Avatar";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import type { FacultyMember } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

const SEARCH_FIELDS = {
  all: { label: "All", keys: ["legalName", "nameAsPerPan", "employeeId", "collegeEmail", "officialEmail", "email", "designation"] },
  name: { label: "Name", keys: ["legalName", "nameAsPerPan"] },
  id: { label: "ID", keys: ["employeeId"] },
  email: { label: "Email", keys: ["collegeEmail", "officialEmail", "email"] },
  designation: { label: "Designation", keys: ["designation"] },
} as const;
type SearchField = keyof typeof SEARCH_FIELDS;

export default function AdministrationDepartmentFacultyPage() {
  const router = useRouter();
  const { id: collegeId, deptId } = useParams<{ id: string; deptId: string }>();
  const [searchField, setSearchField] = useState<SearchField>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-dept-faculty", collegeId, deptId],
    queryFn: () =>
      fetch(`/api/administration/colleges/${collegeId}/departments/${deptId}/faculty`).then(
        (r) => r.json() as Promise<{ faculty?: FacultyRow[]; collegeName?: string; departmentName?: string }>
      ),
  });

  const columns: Column<FacultyRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={facultyDisplayName(row)} photoUrl={row.profilePhotoUrl} size="sm" />
          <span>{facultyDisplayName(row)}</span>
        </div>
      ),
    },
    { key: "employeeId", header: "ID" },
    { key: "email", header: "Email", render: (row) => <span>{row.collegeEmail || row.officialEmail || row.email || "-"}</span> },
    { key: "designation", header: "Designation" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={data?.departmentName ? `${data.departmentName} - Faculty` : "Faculty"}
        description={data?.collegeName ?? "Faculty members in this department"}
        actions={
          <Button variant="outline" onClick={() => router.push(`/administration/colleges/${collegeId}/departments`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <DataTable
        data={data?.faculty ?? []}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(f) => f.id}
        searchPlaceholder={`Search faculty${searchField === "all" ? "" : ` by ${SEARCH_FIELDS[searchField].label.toLowerCase()}`}...`}
        searchKeys={SEARCH_FIELDS[searchField].keys as unknown as (keyof FacultyMember)[]}
        filterFirst
        filterComponent={
          <Select value={searchField} onValueChange={(v) => setSearchField(v as SearchField)}>
            <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SEARCH_FIELDS) as SearchField[]).map((k) => (
                <SelectItem key={k} value={k}>{SEARCH_FIELDS[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        emptyTitle="No faculty in this department"
      />
    </div>
  );
}
