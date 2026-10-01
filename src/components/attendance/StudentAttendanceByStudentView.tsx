"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { SectionFilterBar } from "@/components/shared/SectionFilterBar";
import { StudentAttendanceHistoryReport } from "@/components/attendance/StudentAttendanceHistoryReport";
import { toast } from "@/hooks/useToast";
import type { SectionListItem, StudentListItem } from "@/types";

type StudentRow = Record<string, unknown> & StudentListItem;

// Per-student attendance history on ONE page: pick Department -> Course ->
// Year -> Section, press Load to list that section's students, then open one
// to see their cumulative attendance in place. Replaces the Department ->
// Course -> Section -> Student chain of separate pages (and the HOD's
// roster-wide student picker); the student report itself is unchanged.
export function StudentAttendanceByStudentView({ title = "Student Attendance History" }: { title?: string }) {
  const [section, setSection] = useState<SectionListItem | null>(null);
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [loadedSectionId, setLoadedSectionId] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selected, setSelected] = useState<StudentRow | null>(null);

  async function load() {
    if (!section) {
      toast({ variant: "destructive", title: "Pick a department, course, year and section first" });
      return;
    }
    setIsLoading(true);
    setSelected(null);
    try {
      const params = new URLSearchParams({ section: section.name, year: String(section.year) });
      const res = await fetch(`/api/college/students?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load students");
      const json = (await res.json()) as { students?: StudentRow[] };
      // Section names repeat across departments/courses, so narrow the
      // year+name match to this exact section.
      const rows = (json.students ?? []).filter(
        (s) =>
          (s.department === section.department || s.secondaryDepartment === section.department) &&
          (!section.courseId || !s.courseId || s.courseId === section.courseId)
      );
      rows.sort((a, b) => String(a.rollNumber).localeCompare(String(b.rollNumber), undefined, { numeric: true }));
      setStudents(rows);
      setLoadedSectionId(section.id);
    } catch {
      toast({ variant: "destructive", title: "Failed to load students" });
    } finally {
      setIsLoading(false);
    }
  }

  if (selected) {
    return (
      <StudentAttendanceHistoryReport
        studentId={selected.id}
        studentName={selected.name}
        onBack={() => setSelected(null)}
      />
    );
  }

  const columns: Column<StudentRow>[] = [
    { key: "rollNumber", header: "Reg. No." },
    { key: "name", header: "Name" },
    {
      key: "action",
      header: "",
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => setSelected(row)}>
          View attendance
        </Button>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <SectionFilterBar
          onSelect={(s) => {
            setSection(s);
            // A changed section invalidates the list on screen.
            if (s?.id !== loadedSectionId) setStudents(null);
          }}
        />
        <Button onClick={() => void load()} disabled={!section || isLoading}>
          <Search className="mr-2 h-4 w-4" />
          {isLoading ? "Loading…" : students ? "Reload Students" : "Load Students"}
        </Button>

        {students && (
          <DataTable<StudentRow>
            data={students}
            columns={columns}
            keyExtractor={(r) => r.id}
            searchKeys={["rollNumber", "name"]}
            searchPlaceholder="Search by name or reg. no."
            emptyTitle="No students in this section"
          />
        )}
      </CardContent>
    </Card>
  );
}
