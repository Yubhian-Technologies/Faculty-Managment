"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { MenteeRecord } from "@/components/mentoring/record/MenteeRecord";
import { getJson } from "@/components/mentoring/record/recordApi";

// The student's own Mentoring Record: who their mentor is and the record the mentor keeps
// (details, semester sheets, progress, meetings), read-only. Served by student/me/mentoring.

const API = "/api/college/student/me/mentoring";

type Overview = {
  student: { name: string; rollNumber: string };
  mentor: { name: string; assignedAt: number | null } | null;
};

export default function StudentMentoringPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getJson<Overview>(`${API}?part=mentor`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: Error) => { if (!cancelled) setError(e.message || "Couldn't load your mentoring record."); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader title="Mentoring" description="Your mentor and your Student Mentoring Record. The record is kept by your mentor; you can read it here." />

      {error && <p className="text-sm text-muted-foreground py-6">{error}</p>}
      {!error && !data && <p className="text-sm text-muted-foreground py-6">Loading…</p>}

      {data && (
        <>
          <Card>
            <CardContent className="pt-5 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></span>
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Your mentor</p>
                <p className="font-medium">{data.mentor ? data.mentor.name : "Not assigned yet"}</p>
                {data.mentor?.assignedAt && (
                  <p className="text-xs text-muted-foreground">Since {new Date(data.mentor.assignedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <MenteeRecord apiBase={API} readOnly studentName={data.student.name} rollNumber={data.student.rollNumber} />
        </>
      )}
    </div>
  );
}
