"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plus, Upload } from "lucide-react";
import type { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { MasterSubjectImportDialog } from "@/components/academics/MasterSubjectImportDialog";
import { AddSubjectDialog } from "@/components/academics/AddSubjectDialog";
import { SubjectsMasterTable } from "@/components/academics/SubjectsMasterTable";

// Curriculum > Subjects: the master list of one Course + Regulation. Subjects get here by bulk
// import or one at a time - and only here. Putting them into a department's semester is the next tab.
export function MasterSubjectsStep({ picker }: { picker: ReturnType<typeof useRegulationCourseDepartmentPicker> }) {
  const [showImport, setShowImport] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const course = picker.selectedCourse;
  const regulation = picker.selectedRegulation;
  const courseName = picker.selectedCatalogItem?.name ?? course?.name ?? "";

  if (!picker.isLoaded) {
    return <p className="text-sm text-muted-foreground">Pick a Regulation and Course above, then click Load.</p>;
  }
  if (!course) {
    return <p className="text-sm text-muted-foreground">No active course found for this selection. Check the Course Catalog.</p>;
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium">{courseName} · {regulation}</p>
            <p className="text-xs text-muted-foreground">
              Every subject here has a unique Subject Code and a unique Subject Name within this course and regulation.
              Define extra categories under <Link href="/academics/categories" className="underline">Categories</Link>.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setShowImport((v) => !v); }}><Upload className="mr-1.5 h-4 w-4" />Import subjects</Button>
            <Button onClick={() => setShowAdd(true)}><Plus className="mr-1.5 h-4 w-4" />Add subject</Button>
          </div>
        </CardContent>
      </Card>

      <MasterSubjectImportDialog
        open={showImport}
        onOpenChange={setShowImport}
        courseId={course.id}
        courseName={courseName}
        regulation={regulation}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
      <AddSubjectDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        courseId={course.id}
        courseName={courseName}
        regulation={regulation}
        onAdded={() => setRefreshKey((k) => k + 1)}
      />
      <SubjectsMasterTable key={refreshKey} courseId={course.id} catalogId={course.catalogId} courseName={courseName} regulation={regulation} />
    </div>
  );
}
