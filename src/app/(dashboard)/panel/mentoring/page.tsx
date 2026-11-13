"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenteeList } from "@/components/mentoring/MenteeList";
import type { MenteeSummary } from "@/types/mentoring";

export default function PanelMentoringPage() {
  const [students, setStudents] = useState<MenteeSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/mentoring/my-mentees")
      .then(async (r) => {
        const d = (await r.json().catch(() => ({}))) as { students?: MenteeSummary[]; error?: string };
        if (!r.ok) throw new Error(d.error || "Unable to load your mentees");
        setStudents(d.students ?? []);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      <PageHeader
        title="Mentoring"
        description="Students assigned to you by your HOD. Open a student to follow their attendance, results and internal marks."
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!students && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {students && (
        <MenteeList students={students} basePath="/panel/mentoring" empty="No students have been assigned to you for mentoring yet." />
      )}
    </div>
  );
}
