"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { StudentListItem } from "@/types";

type StudentRow = Record<string, unknown> & StudentListItem;

// Entry point into the per-student attendance history report
// (hod/students/[studentId]/attendance) - pick a student here, same roster
// the Students page lists, then open their Monthly/Period/Till now report.
// A standalone page (rather than only the row action on Students) so it can
// live in the sidebar as its own destination.
export default function HodAttendanceHistoryPage() {
  const router = useRouter();
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deptFilter, setDeptFilter] = useState("all");

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/college/students");
        const json = (await res.json()) as { students?: StudentRow[] };
        setStudents(json.students ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load students" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const departmentNames = useMemo(
    () => Array.from(new Set(
      students.flatMap((s) => [s.department, s.secondaryDepartment]).filter((d): d is string => !!d)
    )).sort(),
    [students]
  );
  const filtered = useMemo(
    () => (deptFilter === "all" ? students : students.filter(
      (s) => s.department === deptFilter || s.secondaryDepartment === deptFilter
    )),
    [students, deptFilter]
  );

  function openHistory(student: StudentRow) {
    router.push(`/hod/students/${student.id}/attendance?name=${encodeURIComponent(student.name)}`);
  }

  const columns: Column<StudentRow>[] = [
    { key: "rollNumber", header: "Roll No", render: (r) => <span className="font-medium">{r.rollNumber || "—"}</span> },
    { key: "name", header: "Name" },
    { key: "department", header: "Department", hideOnMobile: true, render: (r) => <span className="text-sm text-muted-foreground">{r.department}</span> },
    { key: "year", header: "Year", hideOnMobile: true, render: (r) => <span>{r.year}</span> },
    {
      key: "section",
      header: "Section",
      render: (r) => (r.section ? <span>{r.section}</span> : <span className="text-muted-foreground/40">—</span>),
    },
    {
      key: "actions",
      header: "",
      render: (r) => (
        <div className="flex items-center justify-end">
          <Button variant="outline" size="sm" onClick={() => openHistory(r)}>
            <CalendarCheck className="h-3.5 w-3.5 mr-1.5" />View History
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance History"
        description="Pick a student to view their cumulative subject-wise attendance - by month, a custom date range, or their entire history."
      />

      <DataTable
        data={filtered}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by roll number or name..."
        searchKeys={["rollNumber", "name"] as (keyof StudentRow)[]}
        emptyTitle="No students yet"
        emptyDescription="Once the College Office imports your branches' students, they show up here."
        filterComponent={
          <Select value={deptFilter} onValueChange={setDeptFilter}>
            <SelectTrigger className="w-48"><SelectValue placeholder="All departments" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departmentNames.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
