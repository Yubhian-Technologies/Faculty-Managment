"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DashboardSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { formatTime12h } from "@/lib/timetable/facultyTimetablePdf";

interface TodayPeriod {
  id: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  code: string;
  subjectName: string;
  faculty: string;
  isSubstitute: boolean;
  room: string;
  labBatch: string;
}

interface TodayResponse {
  student: { name: string; rollNumber: string } | null;
  message?: string;
  date?: string;
  day?: string | null;
  hasSection?: boolean;
  hasTiming?: boolean;
  className?: string;
  periods?: TodayPeriod[];
}

function longDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
}

// Student home: who you are and what is on today - nothing else. Everything
// else (timetable, attendance, library, documents, profile) is one tap away in
// the menu, so it is not repeated here as cards or counters.
export default function StudentDashboardPage() {
  const [data, setData] = useState<TodayResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/student/me/today")
      .then((r) => r.json() as Promise<TodayResponse>)
      .then(setData)
      .catch(() => toast({ variant: "destructive", title: "Failed to load your dashboard" }))
      .finally(() => setIsLoading(false));
  }, []);

  const student = data?.student;
  const periods = data?.periods ?? [];
  const firstName = student?.name.trim().split(/\s+/)[0];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "My Dashboard"}
        description={student ? [student.rollNumber, data?.className].filter(Boolean).join(" · ") : undefined}
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : !student ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {data?.message ?? "Your login is not linked to a student record yet. Please contact your College Office."}
        </p>
      ) : (
        <section aria-labelledby="today-heading">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 id="today-heading" className="text-base font-semibold">Today</h2>
            {data?.date && <span className="text-sm text-muted-foreground">{longDate(data.date)}</span>}
          </div>

          {!data?.hasSection ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No class is linked to your record yet. Your schedule will appear here once it is.
            </p>
          ) : !data.day ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No classes on Sunday.</p>
          ) : periods.length === 0 ? (
            <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {data.hasTiming ? "No classes scheduled for today." : "Your timetable has not been set up yet."}
            </p>
          ) : (
            <ul className="divide-y rounded-2xl border border-border/60 bg-card/90 shadow-xs">
              {periods.map((p) => (
                <li key={p.id} className="flex gap-3 p-3.5 sm:gap-4 sm:p-4">
                  <div className="w-20 shrink-0 text-xs text-muted-foreground sm:w-28 sm:text-sm">
                    <p className="font-medium text-foreground">Period {p.periodNumber}</p>
                    {p.startTime && p.endTime && (
                      <p className="mt-0.5 leading-snug">
                        {formatTime12h(p.startTime)}
                        <span className="hidden sm:inline"> – </span>
                        <br className="sm:hidden" />
                        {formatTime12h(p.endTime)}
                      </p>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-semibold">
                      {p.code}
                      {p.labBatch && <span className="font-normal text-muted-foreground"> · {p.labBatch}</span>}
                    </p>
                    {p.subjectName && p.subjectName !== p.code && (
                      <p className="break-words text-xs text-muted-foreground">{p.subjectName}</p>
                    )}
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      {p.isSubstitute ? `Substitute: ${p.faculty}` : p.faculty || "Faculty not assigned"}
                      {p.room && ` · Room ${p.room}`}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
