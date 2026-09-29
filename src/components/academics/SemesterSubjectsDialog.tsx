"use client";

import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  BookOpen,
  Calendar,
  Clock,
  ExternalLink,
  Layers,
  Search,
  Sparkles,
  GraduationCap,
} from "lucide-react";
import type { SubjectSemesterAssignment, Course } from "@/types";

interface SemesterSubjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  course: Course | null;
  year: number;
  semester: number;
  academicYearLabel?: string;
  departmentId: string;
  departmentName?: string;
  assignments: SubjectSemesterAssignment[];
  assignHref: string;
  isInherited?: boolean;
}

export function SemesterSubjectsDialog({
  open,
  onOpenChange,
  course,
  year,
  semester,
  academicYearLabel,
  departmentName,
  assignments,
  assignHref,
  isInherited = false,
}: SemesterSubjectsDialogProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredAssignments = useMemo(() => {
    if (!searchQuery.trim()) return assignments;
    const q = searchQuery.toLowerCase().trim();
    return assignments.filter(
      (a) =>
        a.subjectName.toLowerCase().includes(q) ||
        a.subjectCode.toLowerCase().includes(q) ||
        (a.shortCode && a.shortCode.toLowerCase().includes(q))
    );
  }, [assignments, searchQuery]);

  const stats = useMemo(() => {
    const totalCredits = assignments.reduce((acc, curr) => acc + (curr.credits ?? 0), 0);
    const totalHours = assignments.reduce((acc, curr) => acc + (curr.hoursPerWeek ?? 0), 0);
    const theoryCount = assignments.filter((a) => a.type === "THEORY").length;
    const practicalCount = assignments.filter(
      (a) => a.type === "PRACTICAL"
    ).length;

    return { totalCredits, totalHours, theoryCount, practicalCount };
  }, [assignments]);

  if (!course) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl sm:max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0 overflow-hidden rounded-2xl border shadow-xl">
        {/* Header following Google Material 3 surface styling */}
        <div className="p-6 pb-4 border-b bg-muted/20">
          <DialogHeader className="space-y-1.5 text-left">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono text-xs font-semibold px-2 py-0.5">
                {course.code}
              </Badge>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <GraduationCap className="h-3.5 w-3.5" />
                Year {year} · Semester {semester}
              </span>
              {academicYearLabel && (
                <>
                  <span className="text-xs text-muted-foreground">·</span>
                  <Badge variant="outline" className="text-[11px] gap-1 px-1.5 py-0">
                    <Calendar className="h-3 w-3 text-muted-foreground" />
                    AY {academicYearLabel}
                  </Badge>
                </>
              )}
              {isInherited && (
                <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400 border-amber-300">
                  Shared Course
                </Badge>
              )}
            </div>

            <DialogTitle className="text-xl font-bold tracking-tight text-foreground">
              {course.name}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {departmentName ? `${departmentName} · ` : ""}
              Subject allocation for Year {year}, Semester {semester}
            </DialogDescription>
          </DialogHeader>

          {/* Quick Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
            <div className="rounded-xl border bg-background/80 p-2.5 shadow-2xs">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Subjects
              </p>
              <p className="text-lg font-bold text-foreground mt-0.5">{assignments.length}</p>
            </div>
            <div className="rounded-xl border bg-background/80 p-2.5 shadow-2xs">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Total Credits
              </p>
              <p className="text-lg font-bold text-foreground mt-0.5">{stats.totalCredits}</p>
            </div>
            <div className="rounded-xl border bg-background/80 p-2.5 shadow-2xs">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Hours / Week
              </p>
              <p className="text-lg font-bold text-foreground mt-0.5">{stats.totalHours} hrs</p>
            </div>
            <div className="rounded-xl border bg-background/80 p-2.5 shadow-2xs">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Types
              </p>
              <p className="text-xs font-semibold text-foreground mt-1">
                {stats.theoryCount} Theory · {stats.practicalCount} Lab
              </p>
            </div>
          </div>
        </div>

        {/* Search & Actions Bar */}
        <div className="px-6 py-3 border-b bg-background/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search by subject code or name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs rounded-lg"
            />
          </div>
          <Button
            size="sm"
            variant="default"
            asChild
            className="h-9 gap-1.5 text-xs font-medium shrink-0 rounded-lg shadow-2xs"
          >
            <a href={assignHref}>
              <ExternalLink className="h-3.5 w-3.5" />
              Manage in Assign to Semester
            </a>
          </Button>
        </div>

        {/* Subjects List Scroll Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-2.5 min-h-[220px] max-h-[380px]">
          {filteredAssignments.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center px-4">
              <div className="h-12 w-12 rounded-full bg-muted/60 flex items-center justify-center mb-3">
                <BookOpen className="h-6 w-6 text-muted-foreground/60" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">
                {searchQuery ? "No matching subjects found" : "No subjects assigned to this semester"}
              </h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {searchQuery
                  ? "Try changing your search query to find the subject."
                  : "Assign subjects from the Master Curriculum to configure syllabus, timetable, and faculty workloads."}
              </p>
              {!searchQuery && (
                <Button
                  size="sm"
                  variant="outline"
                  asChild
                  className="mt-4 text-xs gap-1.5 rounded-lg border-primary/30 text-primary hover:bg-primary/5"
                >
                  <a href={assignHref}>
                    <Sparkles className="h-3.5 w-3.5" />
                    Assign Subjects Now
                  </a>
                </Button>
              )}
            </div>
          ) : (
            filteredAssignments.map((sub) => (
              <div
                key={sub.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border bg-card hover:bg-muted/30 transition-all gap-2.5"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 flex flex-col items-center justify-center rounded-lg border bg-muted/40 px-2 py-1 shrink-0">
                    <span className="font-mono text-xs font-bold text-foreground">
                      {sub.subjectCode}
                    </span>
                    {sub.shortCode && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {sub.shortCode}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground leading-snug truncate">
                      {sub.subjectName}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {sub.type && (
                        <Badge
                          variant="secondary"
                          className="text-[10px] py-0 px-1.5 font-normal rounded-md"
                        >
                          {sub.type}
                        </Badge>
                      )}
                      {sub.category && (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1.5 font-normal text-muted-foreground rounded-md"
                        >
                          {sub.category}
                        </Badge>
                      )}
                      {sub.regulation && (
                        <span className="text-[10px] text-muted-foreground">
                          Reg: {sub.regulation}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 w-full sm:w-auto justify-between sm:justify-end">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {sub.credits !== undefined && (
                      <span className="inline-flex items-center gap-1 font-medium bg-muted/50 px-2 py-0.5 rounded-md text-[11px]">
                        <span className="text-foreground font-semibold">{sub.credits}</span> Cr
                      </span>
                    )}
                    {sub.hoursPerWeek !== undefined && (
                      <span className="inline-flex items-center gap-1 font-medium bg-muted/50 px-2 py-0.5 rounded-md text-[11px]">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span className="text-foreground font-semibold">{sub.hoursPerWeek}</span> h/wk
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
          <span>
            Showing {filteredAssignments.length} of {assignments.length} subjects
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
