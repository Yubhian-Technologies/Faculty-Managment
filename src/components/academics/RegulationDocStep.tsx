"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import type { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { FileText, Settings } from "lucide-react";

// Curriculum > Regulation Doc step. Reads the shared scope bar's picker -
// only Regulation + Course matter here (Department is unused by this step).
// Regulation-CODE management (add/rename/remove regulations, course
// name/code/duration) lives on its own page, linked below - that's
// catalog-wide admin, not part of picking one course's document.
export function RegulationDocStep({ picker }: { picker: ReturnType<typeof useRegulationCourseDepartmentPicker> }) {
  // Local override so the field reflects an upload immediately - the hook's
  // catalogItems only refetch on Load, so a plain derived value from it would
  // keep showing "not uploaded" until the next Load. Tied to the course +
  // regulation it was uploaded for.
  const [local, setLocal] = useState<{ key: string; url: string } | null>(null);
  const localKey = `${picker.selectedCatalogId}|${picker.selectedRegulation}`;
  const setLocalUrl = (url: string) => setLocal({ key: localKey, url });
  const currentUrl = local?.key === localKey ? local.url : picker.selectedCatalogItem?.regulationDocumentUrls?.[picker.selectedRegulation];

  async function patchRegulationDocument(url: string) {
    await fetch(`/api/college/course-catalog/${picker.selectedCatalogId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regulationDocumentUrls: { [picker.selectedRegulation]: url } }),
    });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Upload Regulation Document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {picker.isLoaded && picker.selectedCatalogId && picker.selectedRegulation ? (
            <DocumentUploadField
              label={`${picker.selectedCatalogItem?.name ?? "Course"} — ${picker.selectedRegulation} Regulation Document`}
              value={currentUrl}
              uploadEndpoint="/api/upload/regulation-document"
              extraFields={{ catalogId: picker.selectedCatalogId, regulation: picker.selectedRegulation }}
              onUploaded={(url) => { setLocalUrl(url); void patchRegulationDocument(url); }}
              onRemoved={() => { setLocalUrl(""); void patchRegulationDocument(""); }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Load a Regulation and Course above to upload its document.</p>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" asChild size="sm">
        <Link href="/academics/course-catalog"><Settings className="h-4 w-4 mr-1.5" />Manage courses &amp; regulation codes</Link>
      </Button>
    </div>
  );
}
