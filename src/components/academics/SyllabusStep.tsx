"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import type { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { FileText } from "lucide-react";

// Curriculum > Syllabus step. Reads the shared scope bar's picker - no
// Regulation/Course/Department selection of its own.
export function SyllabusStep({ picker }: { picker: ReturnType<typeof useRegulationCourseDepartmentPicker> }) {
  // Same local-override pattern as the Regulation Doc step - courses are
  // only refetched on Load, not immediately after a PATCH. Tied to the
  // course + regulation it was uploaded for, so it never leaks into another
  // selection.
  const [local, setLocal] = useState<{ key: string; url: string } | null>(null);
  const localKey = `${picker.selectedCourse?.id ?? ""}|${picker.selectedRegulation}`;
  const setLocalUrl = (url: string) => setLocal({ key: localKey, url });
  const currentUrl = local?.key === localKey ? local.url : picker.selectedCourse?.syllabusUrls?.[picker.selectedRegulation];

  async function patchSyllabus(url: string) {
    if (!picker.selectedCourse) return;
    await fetch(`/api/college/courses/${picker.selectedCourse.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syllabusUrls: { [picker.selectedRegulation]: url } }),
    });
  }

  return (
    <div className="max-w-4xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Upload Syllabus</CardTitle>
        </CardHeader>
        <CardContent>
          {picker.isLoaded && picker.selectedCourse && picker.selectedRegulation ? (
            <DocumentUploadField
              label={`${picker.selectedDepartment?.name ?? "Department"} — ${picker.selectedRegulation} Syllabus`}
              value={currentUrl}
              uploadEndpoint="/api/upload/syllabus-document"
              extraFields={{ courseId: picker.selectedCourse.id, regulation: picker.selectedRegulation }}
              onUploaded={(url) => { setLocalUrl(url); void patchSyllabus(url); }}
              onRemoved={() => { setLocalUrl(""); void patchSyllabus(""); }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Load a Regulation, Course and Department above to upload a syllabus.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
