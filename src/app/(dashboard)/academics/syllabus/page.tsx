"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { ArrowLeft, BookOpen, FileText, AlertTriangle } from "lucide-react";

export default function AcademicsSyllabusPage() {
  const picker = useRegulationCourseDepartmentPicker();

  // Same local-override pattern as regulation/page.tsx - courses is refetched
  // on Department change (loadCourses), but not immediately after a PATCH.
  const [localUrl, setLocalUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLocalUrl(undefined);
  }, [picker.selectedCourse?.id, picker.selectedRegulation]);

  const currentUrl = localUrl ?? picker.selectedCourse?.syllabusUrls?.[picker.selectedRegulation];

  async function patchSyllabus(url: string) {
    if (!picker.selectedCourse) return;
    await fetch(`/api/college/courses/${picker.selectedCourse.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syllabusUrls: { [picker.selectedRegulation]: url } }),
    });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Syllabus"
        description="Upload a department's syllabus document for a course under a regulation."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />

      <Card className="border-primary/20 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-primary" />Regulation, Course &amp; Department</span>
            {picker.selectedCourse && picker.selectedDepartment && (
              <Badge variant="secondary" className="font-mono text-xs">{picker.selectedDepartment.name}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Regulation</Label>
            <Select value={picker.selectedRegulation} onValueChange={picker.selectRegulation}>
              <SelectTrigger><SelectValue placeholder="Select regulation" /></SelectTrigger>
              <SelectContent>
                {picker.topLevelRegulationOptions.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Course</Label>
            <Select value={picker.selectedCatalogId} onValueChange={picker.selectCatalog} disabled={!picker.selectedRegulation}>
              <SelectTrigger><SelectValue placeholder={!picker.selectedRegulation ? "Select a regulation first" : "Select course"} /></SelectTrigger>
              <SelectContent>
                {picker.catalogOptions.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Department</Label>
            <Select value={picker.selectedDepartmentId} onValueChange={picker.selectDepartment} disabled={!picker.selectedCatalogId}>
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
        </CardContent>
        {picker.selectedDepartmentId && !picker.isLoadingCourses && !picker.selectedCourse && (
          <CardContent className="pt-0">
            <p className="text-sm text-amber-600 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{picker.selectedDepartment?.name} doesn&apos;t teach this course yet.</p>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Upload Syllabus</CardTitle>
        </CardHeader>
        <CardContent>
          {picker.selectedCourse && picker.selectedRegulation ? (
            <DocumentUploadField
              label={`${picker.selectedDepartment?.name ?? "Department"} — ${picker.selectedRegulation} Syllabus`}
              value={currentUrl}
              uploadEndpoint="/api/upload/syllabus-document"
              extraFields={{ courseId: picker.selectedCourse.id, regulation: picker.selectedRegulation }}
              onUploaded={(url) => { setLocalUrl(url); void patchSyllabus(url); }}
              onRemoved={() => { setLocalUrl(""); void patchSyllabus(""); }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select Regulation, Course and Department above to upload a syllabus.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
