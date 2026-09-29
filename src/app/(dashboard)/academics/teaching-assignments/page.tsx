"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TeachingAssignmentsEditor } from "@/components/timetable/TeachingAssignmentsEditor";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { regulationsForCourseYearByBatch, fedYears } from "@/lib/college/academicStructure";
import { currentAcademicStartYear } from "@/lib/college/academicSession";
import { managerTeachingYears } from "@/lib/departments/managedBranches";
import { ArrowLeft, BookOpen, AlertTriangle } from "lucide-react";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Same Regulation -> Course -> Department cascade as the other 3 Academics
// tabs, one level deeper (Year) - this tab is deliberately just a browsing
// entry point for TeachingAssignmentsEditor (already role-agnostic, reused
// as-is by hod/timetable, panel/timetable-incharge and
// college-staff/timetable-incharge), not a new assignment mechanism.
// Assigning faculty stays exactly as manual as it already is there.
export default function AcademicsTeachingAssignmentsPage() {
  const picker = useRegulationCourseDepartmentPicker();
  const [selectedYear, setSelectedYear] = useState("");

  // Same narrowing as the old assign-semester page's own yearOptions -
  // which years this exact department actually teaches this course, then
  // filtered to the years the chosen Regulation's own batch coverage governs.
  const yearOptions = useMemo(() => {
    if (!picker.selectedCourse || !picker.selectedDepartment) return [];
    const courseYears = Array.from({ length: picker.selectedCourse.durationYears }, (_, i) => i + 1);
    const catalogId = picker.selectedCourse.catalogId;
    const assigned = managerTeachingYears(picker.allDepartments, picker.selectedDepartment, catalogId);
    const teachableYears = assigned.length > 0
      ? courseYears.filter((y) => assigned.includes(y))
      : courseYears.filter((y) => !new Set(fedYears(picker.selectedDepartment!, picker.allDepartments, catalogId)).has(y));
    if (!picker.selectedCatalogItem) return teachableYears;
    return teachableYears.filter((y) =>
      regulationsForCourseYearByBatch(
        picker.selectedCatalogItem!.regulationBatches ?? {},
        y,
        currentAcademicStartYear(),
        picker.selectedCatalogItem!.regulations,
      ).includes(picker.selectedRegulation)
    );
  }, [picker.selectedCourse, picker.selectedDepartment, picker.allDepartments, picker.selectedCatalogItem, picker.selectedRegulation]);

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Teaching Assignments"
        description="Browse any department's course-year and assign faculty to its subjects - same editor HODs use, opened here for cross-department oversight."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />

      <Card className="border-primary/20 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Regulation, Course, Department &amp; Year</span>
            {picker.selectedCourse && picker.selectedDepartment && selectedYear && (
              <Badge variant="secondary" className="font-mono text-xs">{picker.selectedDepartment.name} · {ordinalYear(Number(selectedYear))}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Regulation</Label>
            <Select value={picker.selectedRegulation} onValueChange={(v) => { picker.selectRegulation(v); setSelectedYear(""); }}>
              <SelectTrigger><SelectValue placeholder="Select regulation" /></SelectTrigger>
              <SelectContent>
                {picker.topLevelRegulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Course</Label>
            <Select value={picker.selectedCatalogId} onValueChange={(v) => { picker.selectCatalog(v); setSelectedYear(""); }} disabled={!picker.selectedRegulation}>
              <SelectTrigger><SelectValue placeholder={!picker.selectedRegulation ? "Select a regulation first" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {picker.catalogOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={picker.selectedDepartmentId} onValueChange={(v) => { picker.selectDepartment(v); setSelectedYear(""); }} disabled={!picker.selectedCatalogId}>
              <SelectTrigger><SelectValue placeholder={!picker.selectedCatalogId ? "Select a course first" : "Select department"} /></SelectTrigger>
              <SelectContent>
                {picker.departments.flatMap((d) => [
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>,
                  ...(picker.childrenOf.get(d.id) ?? []).map((child) => (
                    <SelectItem key={child.id} value={child.id} className="pl-6">{child.name}</SelectItem>
                  )),
                ])}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Year</Label>
            <Select value={selectedYear} onValueChange={setSelectedYear} disabled={!picker.selectedCourse || picker.isLoadingCourses}>
              <SelectTrigger><SelectValue placeholder={picker.isLoadingCourses ? "Loading…" : !picker.selectedDepartmentId ? "Select a department first" : "Select year"} /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        {picker.selectedDepartmentId && !picker.isLoadingCourses && !picker.selectedCourse && (
          <CardContent className="pt-0">
            <p className="text-sm text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{picker.selectedDepartment?.name} doesn&apos;t teach this course yet.</p>
          </CardContent>
        )}
      </Card>

      {picker.selectedCourse && selectedYear && (
        <TeachingAssignmentsEditor
          courseId={picker.selectedCourse.id}
          year={selectedYear}
          backHref="/academics/teaching-assignments"
        />
      )}
    </div>
  );
}
