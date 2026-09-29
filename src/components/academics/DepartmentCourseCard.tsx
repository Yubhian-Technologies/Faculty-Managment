"use client";

import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { DepartmentChipList } from "@/components/shared/DepartmentChipList";
import { CourseYearRow } from "./CourseYearRow";
import {
  GraduationCap,
  Pencil,
  Trash2,
  GitBranch,
  Calendar,
  Layers,
} from "lucide-react";
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
  onEditAcademicYear: (year: number) => void;
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
  onEditAcademicYear,
  onOpenSemesterSubjects,
}: DepartmentCourseCardProps) {
  const isInherited = isSubDepartment && !isOwnCourse;

  const totalCourseSubjects = useMemo(() => {
    return subjectAssignments.filter((a) => a.courseId === course.id).length;
  }, [subjectAssignments, course.id]);

  return (
    <Card className="w-full overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs hover:shadow-md transition-shadow">
      {/* Top Header of Course Card */}
      <CardHeader className="p-5 pb-4 border-b bg-muted/10">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="secondary"
                className="text-xs font-mono font-bold tracking-wide px-2.5 py-0.5 rounded-md"
              >
                {course.code}
              </Badge>

              {isSubDepartment && (
                <Badge
                  variant={isOwnCourse ? "secondary" : "outline"}
                  className="text-[11px] font-normal"
                >
                  {isOwnCourse
                    ? `Managed by ${department?.name}`
                    : `Shared from ${parentDepartment?.name}`}
                </Badge>
              )}

              <Badge variant="outline" className="text-[11px] font-normal gap-1">
                <Calendar className="h-3 w-3 text-muted-foreground" />
                {course.durationYears} {course.durationYears !== 1 ? "years" : "year"} programme
              </Badge>

              {years.length > 0 && years.length < course.durationYears && (
                <Badge
                  variant="outline"
                  className="text-[11px] font-normal border-primary/30 text-primary bg-primary/5"
                >
                  Runs Year{years.length !== 1 ? "s" : ""} {years.join(", ")} here
                </Badge>
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
                  className="h-8 gap-1.5 text-xs rounded-lg"
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
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-lg"
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
                  className="h-8 gap-1.5 text-xs rounded-lg"
                  title="Edit course details"
                  onClick={onEditCourse}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-lg"
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
      <CardContent className="p-5 space-y-4">
        {years.length === 0 ? (
          <div className="py-8 text-center border rounded-xl bg-muted/10 border-dashed">
            <GraduationCap className="h-8 w-8 mx-auto text-muted-foreground/60 mb-2" />
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
                onEditAcademicYear={() => onEditAcademicYear(y)}
                onOpenSemesterSubjects={(semester) =>
                  onOpenSemesterSubjects(course, y, semester)
                }
              />
            );
          })
        )}

        {/* Footer meta info */}
        <div className="pt-2 flex flex-wrap items-center justify-between text-xs text-muted-foreground border-t border-border/50">
          <div className="flex items-center gap-1.5">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              Total across {years.length} active {years.length === 1 ? "year" : "years"}:{" "}
              <strong className="text-foreground">{totalCourseSubjects}</strong> subjects assigned
            </span>
          </div>
          <span className="text-[11px] text-muted-foreground/80">
            Click any semester column to view and manage its syllabus subjects
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
