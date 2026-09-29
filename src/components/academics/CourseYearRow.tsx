"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Clock, CalendarClock, CheckCircle2 } from "lucide-react";
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
  onEditAcademicYear: () => void;
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
  onEditAcademicYear,
  onOpenSemesterSubjects,
}: CourseYearRowProps) {
  // Only return semesters if they are actually configured in timing.semesters
  // or if subjects are assigned to this course & year.
  // Never synthesize fake/empty semesters.
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
    <div className="rounded-xl border bg-muted/20 p-4 transition-all hover:bg-muted/30 hover:border-border/80">
      {/* Top Meta Line: Year heading, Academic Year chip on left, Timings on right */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge
            variant="default"
            className="bg-primary text-primary-foreground font-bold px-2.5 py-1 text-xs rounded-md shadow-2xs"
          >
            Year {year}
          </Badge>

          {/* Academic Year Chip */}
          <button
            type="button"
            disabled={isInherited}
            onClick={isInherited ? undefined : onEditAcademicYear}
            title={
              isInherited
                ? "Academic year follows the parent department"
                : academicYear
                ? "Tap to change or advance academic year"
                : "Tap to configure academic year"
            }
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all ${
              academicYear
                ? "border-emerald-200/80 bg-emerald-50/70 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                : "border-orange-200 bg-orange-50/70 text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300"
            } ${isInherited ? "cursor-default opacity-80" : "cursor-pointer hover:shadow-2xs hover:scale-[1.01]"}`}
          >
            <CalendarClock className="h-3.5 w-3.5 shrink-0" />
            <span>
              {academicYear ? academicYear.label : "Academic Year Required"}
            </span>
            {!isInherited && (
              <span className="text-[10px] opacity-75 underline ml-0.5">
                {academicYear ? "tap to advance" : "tap to set"}
              </span>
            )}
          </button>
        </div>

        {/* Timings & Periods on right */}
        <button
          type="button"
          disabled={isInherited}
          onClick={isInherited ? undefined : onEditTiming}
          title={
            isInherited
              ? "Timings follow the parent department"
              : timing
              ? "Tap to edit college timings and period schedule"
              : "Tap to configure daily timings and periods"
          }
          className={`inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
            timing
              ? "text-emerald-600 dark:text-emerald-400 hover:text-emerald-700"
              : "text-muted-foreground hover:text-foreground"
          } ${isInherited ? "cursor-default opacity-80" : "cursor-pointer"}`}
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          {timing ? (
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span>
                {timing.collegeStartTime}–{timing.collegeEndTime} · {timing.numberOfPeriods} periods
              </span>
            </span>
          ) : (
            <span className="text-muted-foreground">
              {isSubDepartment ? "Not configured" : "Not configured - tap to add"}
            </span>
          )}
        </button>
      </div>

      {/* Semester Columns Grid - ONLY when semesters are actually configured */}
      {semesters.length > 0 && (
        <div className="mt-3.5 pt-3 border-t border-border/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Semesters
            </span>
            <span className="text-[11px] text-muted-foreground">
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
      )}
    </div>
  );
}
