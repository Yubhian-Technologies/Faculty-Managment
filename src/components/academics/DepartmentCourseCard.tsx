"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DepartmentChipList } from "@/components/shared/DepartmentChipList";
import { CourseYearRow } from "./CourseYearRow";
import { Pencil, Trash2, GitBranch, BookOpen } from "lucide-react";
import type {
  Course,
  Department,
  CourseYearTiming,
  CourseAcademicYear,
  SubjectSemesterAssignment,
} from "@/types";

interface DepartmentCourseCardProps {
  course: Course;
  department: Department | null;
  parentDepartment: Department | null;
  isSubDepartment: boolean;
  isOwnCourse: boolean;
  scope: { assignedYears: number[]; secondaryDepartments: string[] };
  years: number[];
  timings: CourseYearTiming[];
  academicYears: CourseAcademicYear[];
  subjectAssignments: SubjectSemesterAssignment[];
  onEditCourse: () => void;
  onDeleteCourse: () => void;
  onCustomiseCourse: () => void;
  onRemoveInherited: () => void;
  onEditTiming: (year: number) => void;
  onAdvanceAcademicYear: (year: number, currentAcademicYear?: CourseAcademicYear) => void;
  onOpenSemesterSubjects: (course: Course, year: number, semester: number) => void;
}

export function DepartmentCourseCard({
  course,
  department,
  parentDepartment,
  isSubDepartment,
  isOwnCourse,
  scope,
  years,
  timings,
  academicYears,
  subjectAssignments,
  onEditCourse,
  onDeleteCourse,
  onCustomiseCourse,
  onRemoveInherited,
  onEditTiming,
  onAdvanceAcademicYear,
  onOpenSemesterSubjects,
}: DepartmentCourseCardProps) {
  const isInherited = isSubDepartment && !isOwnCourse;

  const totalCourseSubjects = useMemo(() => {
    return subjectAssignments.filter((a) => a.courseId === course.id).length;
  }, [subjectAssignments, course.id]);

  return (
    <Card className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      {/* Top Header of Course Card */}
      <CardHeader className="p-5 pb-4 border-b bg-muted/20">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5">
            {/* Meta tags: Clean standard text, no pill badges */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded border bg-background text-foreground">
                {course.code}
              </span>

              {isSubDepartment && (
                <span className="text-xs text-muted-foreground font-medium">
                  ({isOwnCourse ? `Managed by ${department?.name}` : `Shared from ${parentDepartment?.name}`})
                </span>
              )}

              <span className="text-muted-foreground/50">·</span>

              <span className="text-xs text-muted-foreground font-medium">
                {course.durationYears} {course.durationYears !== 1 ? "years" : "year"} programme
              </span>

              <span className="text-muted-foreground/50">·</span>

              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded border bg-primary/10 text-primary border-primary/25 dark:bg-primary/20 dark:text-primary dark:border-primary/30">
                <BookOpen className="h-3 w-3" />
                <span>{totalCourseSubjects}</span> {totalCourseSubjects === 1 ? "Subject" : "Subjects"}
              </span>

              {years.length > 0 && years.length < course.durationYears && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="text-xs text-muted-foreground font-medium">
                    Runs Years {years.join(", ")} here
                  </span>
                </>
              )}
            </div>

            <div>
              <h3 className="text-lg font-bold text-foreground tracking-tight">
                {course.name}
              </h3>
            </div>

            {scope.secondaryDepartments.length > 0 && (
              <div className="pt-1 flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Cross-listed with:</span>
                <DepartmentChipList names={scope.secondaryDepartments} />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-start">
            {isSubDepartment && !isOwnCourse ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs rounded-md"
                  disabled={!course.catalogId}
                  title={
                    course.catalogId
                      ? `Manage this course in ${department?.name} independently`
                      : "This course predates the catalog system and can't be customised"
                  }
                  onClick={onCustomiseCourse}
                >
                  <GitBranch className="h-3.5 w-3.5" />
                  <span>Customise</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-md"
                  disabled={!course.catalogId}
                  title={
                    course.catalogId
                      ? `Remove from ${department?.name} only`
                      : "This course predates the catalog system and can't be removed here"
                  }
                  onClick={onRemoveInherited}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 text-xs rounded-md"
                  title="Edit course details"
                  onClick={onEditCourse}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-md"
                  title="Delete course"
                  onClick={onDeleteCourse}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>

      {/* Card Content: Year Rows */}
      <CardContent className="p-5 space-y-3.5">
        {years.length === 0 ? (
          <div className="py-8 text-center border rounded-lg bg-muted/10 border-dashed">
            <p className="text-sm font-semibold text-foreground">
              No years assigned to this department
            </p>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
              Configure this department&apos;s academic structure or course scope to designate which years
              are taught here.
            </p>
          </div>
        ) : (
          years.map((y) => {
            const timing = timings.find((t) => t.courseId === course.id && t.year === y);
            const academicYear = academicYears.find(
              (a) => a.courseId === course.id && a.year === y
            );

            return (
              <CourseYearRow
                key={y}
                course={course}
                year={y}
                timing={timing}
                academicYear={academicYear}
                subjectAssignments={subjectAssignments}
                isSubDepartment={isSubDepartment}
                isInherited={isInherited}
                onEditTiming={() => onEditTiming(y)}
                onAdvanceAcademicYear={() => onAdvanceAcademicYear(y, academicYear)}
                onOpenSemesterSubjects={(semester) =>
                  onOpenSemesterSubjects(course, y, semester)
                }
              />
            );
          })
        )}

        {/* Footer meta info */}
        <div className="pt-2 flex flex-wrap items-center justify-between text-xs text-muted-foreground border-t border-border/50">
          <span>
            Total across {years.length} active {years.length === 1 ? "year" : "years"}:{" "}
            <strong className="text-foreground">{totalCourseSubjects}</strong> subjects assigned
          </span>
          <span className="text-xs text-muted-foreground/80">
            Click any semester to view assigned subjects
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
