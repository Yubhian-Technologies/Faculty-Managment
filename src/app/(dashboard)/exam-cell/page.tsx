"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardList, CheckCircle2, Clock, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ExamConfiguration, Subject } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

export default function ExamCellDashboard() {
  const [configurations, setConfigurations] = useState<ExamConfiguration[]>([]);
  const [totalSubjects, setTotalSubjects] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const [configRes, subjectRes] = await Promise.all([
          fetch("/api/college/exam-configurations"),
          fetch("/api/college/subjects"),
        ]);
        const configJson = (await configRes.json()) as { configurations?: ExamConfiguration[] };
        const subjectJson = (await subjectRes.json()) as { subjects?: Subject[] };
        setConfigurations(configJson.configurations ?? []);
        // Only course/year-scoped subjects (the ones the cascading selector below
        // can even reach) count toward "how many subjects need configuring".
        setTotalSubjects((subjectJson.subjects ?? []).filter((s) => s.courseId && s.year != null && s.isActive).length);
      } catch {
        // non-critical — cards just show 0
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const configuredCount = configurations.length;
  const pendingCount = Math.max(totalSubjects - configuredCount, 0);
  const internalCount = configurations.filter((c) => c.internalMaxMarks > 0).length;
  const externalCount = configurations.filter((c) => c.externalMaxMarks > 0).length;

  const cards = [
    { label: "Configured Subjects", value: configuredCount, icon: CheckCircle2, tile: "bg-emerald-50 text-emerald-600" },
    { label: "Pending Configurations", value: pendingCount, icon: Clock, tile: "bg-amber-50 text-amber-600" },
    { label: "Internal Configurations", value: internalCount, icon: ClipboardList, tile: "bg-blue-50 text-blue-600" },
    { label: "External Configurations", value: externalCount, icon: Layers, tile: "bg-purple-50 text-purple-600" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exam Cell"
        description="Configure Internal and External examination marks for every course, year, branch and subject."
        actions={
          <Button asChild>
            <Link href="/exam-cell/configure">Configure Examination</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label}>
              <CardContent className="flex items-center gap-3 p-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${c.tile}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-foreground">{isLoading ? "—" : c.value}</p>
                  <p className="text-xs text-muted-foreground">{c.label}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Configured Subjects</h2>
        {isLoading ? (
          <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
        ) : configurations.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No subjects configured yet. Click &ldquo;Configure Examination&rdquo; above to set up Internal/External
              marks for a subject.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Course</th>
                    <th className="px-4 py-3">Branch</th>
                    <th className="px-4 py-3">Year</th>
                    <th className="px-4 py-3">Internal</th>
                    <th className="px-4 py-3">External</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {configurations.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        {c.subjectName} <span className="text-muted-foreground">({c.subjectCode})</span>
                      </td>
                      <td className="px-4 py-2.5">{c.courseName}</td>
                      <td className="px-4 py-2.5">{c.department}</td>
                      <td className="px-4 py-2.5">{ordinalYear(c.year)}</td>
                      <td className="px-4 py-2.5">{c.internalMaxMarks}</td>
                      <td className="px-4 py-2.5">{c.externalMaxMarks}</td>
                      <td className="px-4 py-2.5 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/exam-cell/configure?subjectId=${c.subjectId}`}>Edit</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
