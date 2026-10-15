"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";
import type { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { SyllabusStep } from "@/components/academics/SyllabusStep";
import { RegulationDocStep } from "@/components/academics/RegulationDocStep";

// Curriculum > Documents: the Regulation Document covers a Course + Regulation as a whole; the
// Syllabus is specific to a department. Neither touches subjects.
export function DocumentsStep({ picker }: { picker: ReturnType<typeof useRegulationCourseDepartmentPicker> }) {
  const [docView, setDocView] = useState<"regulation" | "syllabus">("regulation");

  if (!picker.isLoaded || !picker.selectedCourse || !picker.selectedRegulation) {
    return <p className="text-sm text-muted-foreground">Pick a Regulation and Course above, then click Load.</p>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><FileText className="h-4 w-4" />Documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The Regulation Document covers {picker.selectedCourse.name} · {picker.selectedRegulation} as a whole. The Syllabus is specific to {picker.selectedDepartment?.name ?? "a department"}.
        </p>
        <div role="tablist" className="inline-flex gap-1 rounded-lg bg-muted p-1">
          {([["regulation", "Regulation Document"], ["syllabus", "Syllabus"]] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={docView === key}
              onClick={() => setDocView(key)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                docView === key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pt-1">
          {docView === "regulation" ? <RegulationDocStep picker={picker} /> : <SyllabusStep picker={picker} />}
        </div>
      </CardContent>
    </Card>
  );
}
