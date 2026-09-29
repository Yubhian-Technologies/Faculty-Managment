"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { DEFAULT_SHORTAGE_THRESHOLD, isShortageByPercent } from "@/lib/studentAttendance/shortage";
import { formatPercent } from "@/lib/studentAttendance/percentage";
import type { StudentAttendanceHistory } from "@/lib/studentAttendance/history";

// "My Attendance" - cumulative per-subject Held/Attend/% for the logged-in
// student, "till now" (no range picker - a student wants the current
// standing, not a report). Same dual-layout convention as panel/mark-
// attendance/page.tsx: stacked cards on small screens, a table from sm up.
export default function StudentAttendancePage() {
  const [attendance, setAttendance] = useState<StudentAttendanceHistory | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/student/me")
      .then((r) => r.json() as Promise<{ attendance?: StudentAttendanceHistory | null }>)
      .then((d) => setAttendance(d.attendance ?? null))
      .catch(() => toast({ variant: "destructive", title: "Failed to load attendance" }))
      .finally(() => setIsLoading(false));
  }, []);

  const overallShort = attendance ? isShortageByPercent(attendance.total.percent, DEFAULT_SHORTAGE_THRESHOLD) : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader title="My Attendance" description="Your cumulative attendance by subject" />
        <Button asChild variant="outline" size="sm">
          <Link href="/student">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Dashboard
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />
      ) : !attendance || attendance.subjects.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/10">
          <p className="font-semibold text-foreground text-base">No Attendance Records Yet</p>
          <p className="mt-1 text-xs">Attendance will appear here once your faculty start marking it.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-4 sm:p-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Overall Attendance</p>
                <p className="text-2xl font-bold text-foreground mt-0.5">{formatPercent(attendance.total.percent)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {attendance.total.attend} / {attendance.total.held} classes attended
                </p>
              </div>
              <Badge variant={overallShort ? "destructive" : "default"} className="gap-1.5 shrink-0">
                {overallShort ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                {overallShort ? `Below ${DEFAULT_SHORTAGE_THRESHOLD}%` : "On Track"}
              </Badge>
            </CardContent>
          </Card>

          {/* Mobile: stacked cards */}
          <div className="divide-y rounded-lg border sm:hidden">
            {attendance.subjects.map((s) => {
              const short = isShortageByPercent(s.percent, DEFAULT_SHORTAGE_THRESHOLD);
              return (
                <div key={s.subjectId} className="p-3.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-sm text-foreground truncate">{s.subjectName}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">{s.subjectCode}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {s.attend} / {s.held} held
                    </p>
                  </div>
                  <Badge variant={short ? "destructive" : "secondary"} className="shrink-0">
                    {formatPercent(s.percent)}
                  </Badge>
                </div>
              );
            })}
          </div>

          {/* sm and up: table */}
          <div className="hidden overflow-x-auto rounded-lg border sm:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <th className="p-3 font-medium">Subject</th>
                  <th className="p-3 font-medium">Code</th>
                  <th className="p-3 font-medium text-right">Held</th>
                  <th className="p-3 font-medium text-right">Attended</th>
                  <th className="p-3 font-medium text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {attendance.subjects.map((s, i) => {
                  const short = isShortageByPercent(s.percent, DEFAULT_SHORTAGE_THRESHOLD);
                  return (
                    <tr key={s.subjectId} className={`border-b last:border-0 ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                      <td className="p-3 font-medium">{s.subjectName}</td>
                      <td className="p-3 text-muted-foreground font-mono">{s.subjectCode}</td>
                      <td className="p-3 text-right">{s.held}</td>
                      <td className="p-3 text-right">{s.attend}</td>
                      <td className="p-3 text-right">
                        <Badge variant={short ? "destructive" : "secondary"}>{formatPercent(s.percent)}</Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
