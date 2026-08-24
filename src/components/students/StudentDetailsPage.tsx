"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RosterDetailView } from "@/components/students/RosterFieldInputs";
import type { StudentRecord } from "@/types";

interface StudentDetailsPageProps {
  studentId: string;
  // Where "Back" returns to - the caller's own students list (e.g.
  // /hod/students, /principal/students). Kept as a prop rather than
  // hardcoded so this one component serves every role's route, same
  // pattern as TimetableGridEditor/StudentAttendanceHistoryReport.
  backHref: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  REGULAR: "default",
  DETAINED: "destructive",
  GRADUATED: "secondary",
};

// Loads fresh on every visit (bookmark/refresh-safe) via GET
// /api/college/students/[id] - deliberately not fed from a list page's
// already-loaded row, since a direct URL visit has none. RosterDetailView
// itself is reused as-is for the actual field layout (Identity + Admission
// Details) - this component only adds the page shell around it.
export function StudentDetailsPage({ studentId, backHref }: StudentDetailsPageProps) {
  const router = useRouter();
  const [student, setStudent] = useState<StudentRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/college/students/${studentId}`);
        const json = await res.json() as { student?: StudentRecord; error?: string };
        if (!res.ok) {
          setError(json.error ?? "Failed to load student");
          return;
        }
        setStudent(json.student ?? null);
      } catch {
        setError("Network error");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [studentId]);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={student ? student.name : "Student Details"}
        description={student ? `Roll No: ${student.rollNumber || "—"}` : undefined}
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : error || !student ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {error ?? "Student not found"}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-4 space-y-4">
            <Badge variant={STATUS_VARIANT[student.status] ?? "secondary"}>{student.status}</Badge>
            <RosterDetailView student={student} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
