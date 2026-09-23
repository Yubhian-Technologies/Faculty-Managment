"use client";

import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import type { MidPaperAssignment } from "@/types";

// Question entry (min 10 required, extra ones optional, no two identical) is
// its own follow-up piece - this is just "here's what you've been assigned",
// the HOD's Mid Paper Setter's counterpart on the faculty side.
export default function FacultyMidBankPage() {
  const [assignments, setAssignments] = useState<MidPaperAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/mid-paper-assignments");
        const data = (await res.json()) as { assignments?: MidPaperAssignment[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? "Failed to load");
        setAssignments(data.assignments ?? []);
      } catch (e) {
        toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load your assignments" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Add Mid Bank"
        description="Subjects you've been assigned to prepare a Mid's question bank for."
      />

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : assignments.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm text-muted-foreground">You haven&apos;t been assigned to prepare any Mid question bank yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => (
            <Card key={a.id}>
              <CardContent className="p-4 flex flex-wrap items-center gap-3">
                <BookOpen className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{a.subjectName} <span className="text-muted-foreground font-normal">({a.subjectCode})</span></p>
                  <p className="text-xs text-muted-foreground">{a.courseName ?? ""} {a.courseName ? "· " : ""}Year {a.year}</p>
                </div>
                <Badge variant="outline">Mid {a.midNumber}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
