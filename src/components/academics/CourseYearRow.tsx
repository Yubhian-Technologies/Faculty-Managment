"use client";

import { useMemo } from "react";
import { BookOpen, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SemesterColumnCard } from "./SemesterColumnCard";
import type {
  Course,
  CourseYearTiming,
  CourseAcademicYear,
  SubjectSemesterAssignment,
  SemesterDuration,
} from "@/types";

interface CourseYearRowProps {
  course: Course;
  year: number;
  timing?: CourseYearTiming;
  academicYear?: CourseAcademicYear;
  subjectAssignments: SubjectSemesterAssignment[];
  isSubDepartment?: boolean;
  isInherited?: boolean;
  onEditTiming: () => void;
  onAdvanceAcademicYear: () => void;
  onOpenSemesterSubjects: (semester: number) => void;
}

export function CourseYearRow({
  course,
  year,
  timing,
  academicYear,
  subjectAssignments,
  isSubDepartment = false,
  isInherited = false,
  onEditTiming,
  onAdvanceAcademicYear,
  onOpenSemesterSubjects,
}: CourseYearRowProps) {
  // Only display semesters if actually configured in timing.semesters
  // or if subjects are assigned to this course & year.
  const semesters = useMemo((): { semester: number; duration?: SemesterDuration }[] => {
    if (timing?.semesters && timing.semesters.length > 0) {
      return timing.semesters
        .slice()
        .sort((a, b) => a.semester - b.semester)
        .map((s) => ({ semester: s.semester, duration: s }));
    }

    const assignedSemNumbers = Array.from(
      new Set(
        subjectAssignments
          .filter((a) => a.courseId === course.id && a.year === year)
          .map((a) => a.semester)
      )
    ).sort((a, b) => a - b);

    if (assignedSemNumbers.length > 0) {
      return assignedSemNumbers.map((s) => ({ semester: s }));
    }

    return [];
  }, [timing, subjectAssignments, course.id, year]);

  const yearTotalSubjects = useMemo(() => {
    return subjectAssignments.filter(
      (a) => a.courseId === course.id && a.year === year
    ).length;
  }, [subjectAssignments, course.id, year]);

  return (
    <div className="rounded-lg border bg-card p-4 transition-colors hover:bg-muted/10">
      {/* Top Line: Year identifier and Academic Year on left, Timings on right */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-bold text-sm text-foreground">
            Year {year}
          </span>

          {/* Prominent Subject Count for this Year */}
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-0.5 rounded-md border ${
              yearTotalSubjects > 0
                ? "bg-primary/10 text-primary border-primary/25 dark:bg-primary/20 dark:text-primary dark:border-primary/30"
                : "bg-muted/80 text-muted-foreground border-border"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            <span className="font-bold">{yearTotalSubjects}</span> {yearTotalSubjects === 1 ? "Subject" : "Subjects"}
          </span>

          <span className="text-muted-foreground/40 text-xs">|</span>

          {/* Academic Year Info & Subtle Action */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Academic Year:
            </span>
            <span className={`text-xs font-semibold ${academicYear ? "text-foreground" : "text-amber-600 dark:text-amber-400"}`}>
              {academicYear ? academicYear.label : "Not Configured"}
            </span>

            {!isInherited && (
              <Button
                variant={academicYear ? "ghost" : "outline"}
                size="sm"
                onClick={onAdvanceAcademicYear}
                className={`h-6 text-xs px-2 rounded-md font-medium ${
                  academicYear
                    ? "text-muted-foreground hover:text-foreground hover:bg-muted"
                    : "text-amber-700 border-amber-300 dark:text-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                }`}
              >
                {academicYear ? "Advance AY →" : "Set AY"}
              </Button>
            )}
          </div>
        </div>

        {/* Timings on right with clean button */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-xs text-muted-foreground">
            {timing ? (
              <span className="text-foreground font-medium">
                {timing.collegeStartTime}–{timing.collegeEndTime} ({timing.numberOfPeriods} periods)
              </span>
            ) : (
              <span className="text-muted-foreground italic">
                Timings not configured
              </span>
            )}
          </span>

          {!isInherited && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onEditTiming}
              className="h-7 text-xs px-2 text-primary hover:text-primary hover:bg-primary/5"
            >
              {timing ? "Edit Timings" : "Add Timings"}
            </Button>
          )}
        </div>
      </div>

      {/* Semesters Grid or Accessible Empty State */}
      {semesters.length > 0 ? (
        <div className="mt-3.5 pt-3 border-t border-border/50">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Semesters
            </span>
            <span className="text-xs text-muted-foreground">
              {yearTotalSubjects} {yearTotalSubjects === 1 ? "subject" : "subjects"} assigned
            </span>
          </div>

          <div
            className={`grid gap-3 ${
              semesters.length === 1
                ? "grid-cols-1 max-w-sm"
                : semesters.length === 2
                ? "grid-cols-1 sm:grid-cols-2"
                : semesters.length === 3
                ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
                : "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
            }`}
          >
            {semesters.map((s) => {
              const semAssignments = subjectAssignments.filter(
                (a) =>
                  a.courseId === course.id &&
                  a.year === year &&
                  a.semester === s.semester
              );

              return (
                <SemesterColumnCard
                  key={s.semester}
                  semester={s.semester}
                  duration={s.duration}
                  assignments={semAssignments}
                  onClick={() => onOpenSemesterSubjects(s.semester)}
                />
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <p className="text-xs font-semibold text-foreground">
              No Semesters Configured for Year {year}
            </p>
            {!isInherited && (
              <Button
                variant="outline"
                size="sm"
                onClick={onEditTiming}
                className="h-7 text-xs font-medium gap-1.5 shrink-0"
              >
                <CalendarRange className="h-3.5 w-3.5" />
                Add Semesters & Timings
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
