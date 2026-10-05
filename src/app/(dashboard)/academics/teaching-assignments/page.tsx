"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TeachingAssignmentsEditor } from "@/components/timetable/TeachingAssignmentsEditor";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { regulationsForCourseYearByBatch } from "@/lib/college/academicStructure";
import { currentAcademicStartYear } from "@/lib/college/academicSession";
import { managerTeachingYears } from "@/lib/departments/managedBranches";
import { ArrowLeft, AlertTriangle } from "lucide-react";

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
  // The year the editor was last loaded for - the editor only shows while
  // every filter still matches what was loaded (Load button).
  const [loadedYear, setLoadedYear] = useState("");
  const isLoaded = picker.isLoaded && loadedYear === selectedYear;

  // Same narrowing as the old assign-semester page's own yearOptions -
  // which years this exact department actually teaches this course, then
  // filtered to the years the chosen Regulation's own batch coverage governs.
  // Built from the catalog entry (already loaded for the dropdowns), so the
  // Year can be picked before Load fetches the department's course.
  const yearOptions = useMemo(() => {
    if (!picker.selectedCatalogItem || !picker.selectedDepartment) return [];
    const courseYears = Array.from({ length: Number(picker.selectedCatalogItem.durationYears) || 0 }, (_, i) => i + 1);
    const catalogId = picker.selectedCatalogItem.id;
    const assigned = managerTeachingYears(picker.allDepartments, picker.selectedDepartment, catalogId);
    // Unconfigured (no Years Taught) = no years, never "every year" - lib/college/taughtYears.ts.
    const teachableYears = courseYears.filter((y) => assigned.includes(y));
    if (!picker.selectedCatalogItem) return teachableYears;
    return teachableYears.filter((y) =>
      regulationsForCourseYearByBatch(
        picker.selectedCatalogItem!.regulationBatches ?? {},
        y,
        currentAcademicStartYear(),
        picker.selectedCatalogItem!.regulations,
      ).includes(picker.selectedRegulation)
    );
  }, [picker.selectedDepartment, picker.allDepartments, picker.selectedCatalogItem, picker.selectedRegulation]);

  const canLoad = !!picker.selectedRegulation && !!picker.selectedCatalogId && !!picker.selectedDepartmentId && !!selectedYear;
  async function handleLoad() {
    const year = selectedYear;
    const { ok } = await picker.load();
    if (ok) setLoadedYear(year);
  }

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
          <CardTitle className="text-base">Regulation, Course, Department and Year</CardTitle>
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
            <Select value={selectedYear} onValueChange={setSelectedYear} disabled={!picker.selectedDepartmentId}>
              <SelectTrigger><SelectValue placeholder={!picker.selectedDepartmentId ? "Select a department first" : "Select year"} /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{ordinalYear(y)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
        <CardContent className="pt-0">
          <Button onClick={() => void handleLoad()} disabled={!canLoad || picker.isLoadingData} loading={picker.isLoadingData}>
            Load
          </Button>
          {!isLoaded && canLoad && !picker.isLoadingData && (
            <span className="ml-3 text-sm text-muted-foreground">Click Load to open this course-year&apos;s teaching assignments.</span>
          )}
        </CardContent>
        {picker.isLoaded && picker.selectedDepartmentId && !picker.isLoadingCourses && !picker.selectedCourse && (
          <CardContent className="pt-0">
            <p className="text-sm text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{picker.selectedDepartment?.name} doesn&apos;t teach this course yet.</p>
          </CardContent>
        )}
      </Card>

      {isLoaded && picker.selectedCourse && selectedYear && (
        <TeachingAssignmentsEditor
          courseId={picker.selectedCourse.id}
          year={selectedYear}
          backHref="/academics/teaching-assignments"
        />
      )}
    </div>
  );
}
