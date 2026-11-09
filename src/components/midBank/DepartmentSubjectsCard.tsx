"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SYLLABUS_STATUS_LABEL } from "@/lib/subjects/syllabus";
import type { SubjectSyllabusStatus } from "@/types";

// HOD: the subjects their department looks after (Subject Department, set by Academics) in every
// branch they are taught - the HOD keeps each one's syllabus here; their question banks / papers
// come to this HOD for approval. Hidden when the department looks after none.

interface Row { id: string; name: string; code: string; courseName: string; regulation: string; department: string; syllabusUrl: string | null; syllabusFileName: string | null; syllabusUpdatedByName: string | null; isActive: boolean; syllabusStatus: SubjectSyllabusStatus | null }

export function DepartmentSubjectsCard() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let off = false;
    fetch("/api/college/subjects/owned")
      .then(async (res) => { const d = (await res.json()) as { subjects?: Row[] }; if (!off) setRows(res.ok ? d.subjects ?? [] : []); })
      .catch(() => { if (!off) setRows([]); });
    return () => { off = true; };
  }, []);

  if (!rows || rows.length === 0) return null;
  const active = rows.filter((r) => r.isActive);
  return (
    <Card className="rounded-2xl">
      <CardContent className="space-y-3 p-5">
        <div>
          <h2 className="font-semibold">Subjects your department looks after</h2>
          <p className="text-xs text-muted-foreground">Set by Academics. You prepare their syllabus (units, COs, CO-PO mapping) for Academics to freeze, and their question banks / papers come to you for approval from every branch they are taught in.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1.5 pr-3">Subject</th><th className="py-1.5 pr-3">Course · Regulation</th><th className="py-1.5 pr-3">Department</th><th className="py-1.5">Syllabus</th></tr>
            </thead>
            <tbody className="divide-y">
              {active.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3"><span className="font-medium">{r.name}</span> <span className="font-mono text-xs text-muted-foreground">{r.code}</span></td>
                  <td className="py-1.5 pr-3 text-xs">{r.courseName}{r.regulation ? ` · ${r.regulation}` : ""}</td>
                  <td className="py-1.5 pr-3 text-xs">{r.department}</td>
                  <td className="py-1.5 whitespace-nowrap">
                    {/* The syllabus (PDF, units, COs, CO-PO) is prepared on its own page, then frozen by Academics. */}
                    {r.syllabusUrl && <a href={r.syllabusUrl} target="_blank" rel="noreferrer" className="mr-2 inline-flex items-center gap-1 text-primary underline" title={[r.syllabusFileName, r.syllabusUpdatedByName && `by ${r.syllabusUpdatedByName}`].filter(Boolean).join(" ")}><FileText className="h-3.5 w-3.5" />PDF</a>}
                    <Link href={`/hod/subjects/syllabus/${encodeURIComponent(r.id)}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium text-primary hover:bg-primary/5">
                      {r.syllabusStatus ? SYLLABUS_STATUS_LABEL[r.syllabusStatus] : "Prepare syllabus"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
