"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { EXAM_TYPE_LABELS, type InternalMark } from "@/types";

type MarkRow = Record<string, unknown> & InternalMark;

export default function HodInternalMarksPage() {
  const [marks, setMarks] = useState<MarkRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/internal-marks")
      .then((r) => r.json() as Promise<{ marks: MarkRow[] }>)
      .then((d) => setMarks(d.marks ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load internal marks" }))
      .finally(() => setIsLoading(false));
  }, []);

  const columns: Column<MarkRow>[] = [
    { key: "studentName", header: "Student", render: (row) => (
      <div>
        <p className="font-medium">{row.studentName}</p>
        <p className="text-xs text-muted-foreground">{row.rollNumber}</p>
      </div>
    ) },
    { key: "sectionName", header: "Section" },
    { key: "subjectName", header: "Subject", hideOnMobile: true },
    { key: "examType", header: "Type", render: (row) => (
      <Badge variant={row.examType === "LAB" ? "secondary" : "default"} className="text-xs">
        {EXAM_TYPE_LABELS[row.examType]}
      </Badge>
    ) },
    { key: "assessmentName", header: "Assessment" },
    { key: "marksObtained", header: "Marks", render: (row) => `${row.marksObtained} / ${row.maxMarks}` },
    { key: "facultyName", header: "Faculty", hideOnMobile: true },
    { key: "updatedAt", header: "Updated", hideOnMobile: true, render: (row) => formatDate(row.updatedAt as Parameters<typeof formatDate>[0]) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Internal Marks"
        description="Internal assessment marks recorded by faculty across your department"
      />

      <DataTable
        data={marks}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by student, subject, faculty..."
        searchKeys={["studentName", "rollNumber", "subjectName", "facultyName", "sectionName"]}
        emptyTitle="No internal marks recorded yet"
        emptyDescription="Marks entered by faculty for sections/subjects in your department will appear here"
        csvFilename="internal-marks"
      />
    </div>
  );
}
