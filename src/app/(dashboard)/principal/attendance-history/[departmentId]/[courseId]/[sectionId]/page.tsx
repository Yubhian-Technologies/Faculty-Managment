"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { StudentListItem } from "@/types";

type StudentRow = Record<string, unknown> & StudentListItem;

// Step 4: every student in the picked section - GET /api/college/students
// filtered by the section's raw name + year (query params carried from the
// Section step; StudentRecord doesn't store a sectionId reference, only
// department/section-name/year - see StudentRecord.courseId's own
// doc-comment on why a section name alone can't disambiguate two courses
// sharing one), narrowed further to this course client-side as a backstop.
// Picking "View History" opens the same per-student report HOD's own
// Attendance History uses (see hod/students/[studentId]/attendance -
// /api/college/student-attendance-history already allows PRINCIPAL/VP with
// no department restriction, same as every other route in this drill-down).
export default function PrincipalAttendanceHistoryStudentsPage() {
  const router = useRouter();
  const { departmentId, courseId, sectionId } = useParams<{
    departmentId: string; courseId: string; sectionId: string;
  }>();
  const searchParams = useSearchParams();
  const deptLabel = searchParams.get("deptLabel") || "Department";
  const courseLabel = searchParams.get("courseLabel") || "Course";
  const sectionLabel = searchParams.get("sectionLabel") || "Section";
  const sectionName = searchParams.get("sectionName") || "";
  const sectionYear = searchParams.get("sectionYear") || "";

  const [students, setStudents] = useState<StudentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams();
        if (sectionName) params.set("section", sectionName);
        if (sectionYear) params.set("year", sectionYear);
        const res = await fetch(`/api/college/students?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load students");
        const json = (await res.json()) as { students?: StudentRow[] };
        setStudents((json.students ?? []).filter((s) => !s.courseId || s.courseId === courseId));
      } catch {
        toast({ variant: "destructive", title: "Failed to load students" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sectionName, sectionYear, courseId]);

  const backHref = `/principal/attendance-history/${departmentId}/${courseId}`
    + `?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}`;

  function openHistory(student: StudentRow) {
    router.push(
      `/principal/attendance-history/${departmentId}/${courseId}/${sectionId}/${student.id}`
      + `?name=${encodeURIComponent(student.name)}`
      + `&deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}&sectionLabel=${encodeURIComponent(sectionLabel)}`
    );
  }

  const columns: Column<StudentRow>[] = [
    { key: "rollNumber", header: "Roll No", render: (r) => <span className="font-medium">{r.rollNumber || "—"}</span> },
    {
      key: "name",
      header: "Name",
      // Section names aren't unique college-wide (see the fetch effect's own
      // comment) - a first-year student physically enrolled under a
      // different department (e.g. Basic Science) but pre-registered to this
      // one can share this exact section name/year and turn up here. Flag it
      // so it doesn't read as this department's own student.
      render: (r) => (
        <span>
          {r.name}
          {r.department && r.department !== deptLabel && (
            <span className="ml-1.5 text-xs text-muted-foreground">({r.department})</span>
          )}
        </span>
      ),
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
        title={sectionLabel}
        description="Pick a student to view their cumulative subject-wise attendance."
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <DataTable
        data={students}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by roll number or name..."
        searchKeys={["rollNumber", "name"] as (keyof StudentRow)[]}
        emptyTitle="No students yet"
        emptyDescription="No students are placed in this section yet."
      />
    </div>
  );
}
