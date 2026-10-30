"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenteeRecord } from "@/components/mentoring/record/MenteeRecord";
import { getJson } from "@/components/mentoring/record/recordApi";
import type { MenteeSummary } from "@/types/mentoring";

// Principal / Vice-Principal: one student's Mentoring Record, read-only (college-students/[id]).

export default function PrincipalMenteePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const api = `/api/college/mentoring/college-students/${studentId}`;
  const [student, setStudent] = useState<MenteeSummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getJson<{ student: MenteeSummary }>(`${api}?part=summary`)
      .then((d) => { if (!cancelled) setStudent(d.student); })
      .catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [api]);

  return (
    <div className="space-y-5">
      <Link href="/principal/mentoring" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground print:hidden">
        <ArrowLeft className="h-4 w-4" /> Back to Mentoring
      </Link>
      {error && <p className="text-sm text-muted-foreground py-6">{error}</p>}
      {!error && !student && <p className="text-sm text-muted-foreground py-6">Loading…</p>}
      {student && (
        <>
          <PageHeader
            title={student.name}
            description={[student.rollNumber, student.department, student.section && `Section ${student.section}`, `Year ${student.year}`, student.mentorName ? `Mentor: ${student.mentorName}` : "No mentor assigned"].filter(Boolean).join(" · ")}
          />
          <MenteeRecord apiBase={api} readOnly studentName={student.name} rollNumber={student.rollNumber} />
        </>
      )}
    </div>
  );
}
