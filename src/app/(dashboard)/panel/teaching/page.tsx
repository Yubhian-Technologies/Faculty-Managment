"use client";

import { useEffect, useState } from "react";
import { BookOpen, Clock, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { TeachingAssignment, TimetableSlot } from "@/types";
import { DAY_LABELS } from "@/types";

export default function TeachingLoadPage() {
  const [assignments, setAssignments] = useState<TeachingAssignment[]>([]);
  const [timetableSlots, setTimetableSlots] = useState<TimetableSlot[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/college/teaching-assignments");
        if (!res.ok) throw new Error("Failed to load teaching assignments");
        const json = await res.json() as {
          assignments: TeachingAssignment[];
          timetableSlots: TimetableSlot[];
        };
        setAssignments(json.assignments ?? []);
        setTimetableSlots(json.timetableSlots ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load teaching load" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const totalHoursPerWeek = assignments.reduce((sum, a) => sum + (a.hoursPerWeek ?? 0), 0);
  const subjectCount = assignments.length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Teaching Load"
          description="Assigned subjects and timetable for current semester"
        />
        <div className="grid grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Teaching Load"
        description="Assigned subjects and timetable for current semester"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Layers className="h-8 w-8 text-indigo-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Subjects</p>
              <p className="text-2xl font-bold mt-1">{subjectCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <Clock className="h-8 w-8 text-blue-500 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">Hours / Week</p>
              <p className="text-2xl font-bold mt-1">{totalHoursPerWeek}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Assignment cards */}
      {assignments.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground">
              No teaching assignments found for the current semester.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {assignments.map((assignment) => {
            const slots = timetableSlots.filter(
              (s) => s.assignmentId === assignment.id
            );

            const DAY_ORDER: Record<string, number> = {
              MON: 0, TUE: 1, WED: 2, THU: 3, FRI: 4, SAT: 5,
            };
            const sortedSlots = [...slots].sort((a, b) => {
              const dayDiff = (DAY_ORDER[a.day] ?? 99) - (DAY_ORDER[b.day] ?? 99);
              if (dayDiff !== 0) return dayDiff;
              return a.periodNumber - b.periodNumber;
            });

            return (
              <Card key={assignment.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-base leading-tight">
                        {assignment.subjectName}
                      </CardTitle>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {assignment.subjectCode}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Metadata row */}
                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                    {assignment.courseName && (
                      <span>
                        <span className="font-medium text-foreground">Course:</span>{" "}
                        {assignment.courseName}
                      </span>
                    )}
                    {assignment.year !== undefined && (
                      <span>
                        <span className="font-medium text-foreground">Year:</span>{" "}
                        {assignment.year}
                      </span>
                    )}
                    {assignment.sectionName && (
                      <span>
                        <span className="font-medium text-foreground">Section:</span>{" "}
                        {assignment.sectionName}
                      </span>
                    )}
                    <span>
                      <span className="font-medium text-foreground">Hours/Week:</span>{" "}
                      {assignment.hoursPerWeek}
                    </span>
                  </div>

                  {/* Timetable slots */}
                  {sortedSlots.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                        Timetable
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {sortedSlots.map((slot) => (
                          <div
                            key={slot.id}
                            className="rounded-md border bg-muted/40 px-3 py-1.5 text-sm"
                          >
                            <span className="font-medium">
                              {DAY_LABELS[slot.day] ?? slot.day}
                            </span>
                            <span className="text-muted-foreground">
                              {" "}· Period {slot.periodNumber}
                            </span>
                            {slot.classroom && (
                              <span className="text-muted-foreground">
                                {" "}· {slot.classroom}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
