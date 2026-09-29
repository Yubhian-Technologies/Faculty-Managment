"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DocumentUploadField } from "@/components/shared/DocumentUploadField";
import { CourseCatalogSettingsCard } from "@/components/academics/CourseCatalogSettingsCard";
import { useRegulationCourseDepartmentPicker } from "@/lib/subjects/hooks/useRegulationCourseDepartmentPicker";
import { ArrowLeft, FileText } from "lucide-react";

export default function AcademicsRegulationPage() {
  const picker = useRegulationCourseDepartmentPicker();

  // Local override so the field reflects an upload immediately - the hook's
  // own catalogItems only refetches on mount, so a plain derived value from
  // it would keep showing "not uploaded" until a full page reload.
  const [localUrl, setLocalUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    setLocalUrl(undefined);
  }, [picker.selectedCatalogId, picker.selectedRegulation]);

  const currentUrl = localUrl ?? picker.selectedCatalogItem?.regulationDocumentUrls?.[picker.selectedRegulation];

  async function patchRegulationDocument(url: string) {
    await fetch(`/api/college/course-catalog/${picker.selectedCatalogId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regulationDocumentUrls: { [picker.selectedRegulation]: url } }),
    });
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Regulation"
        description="Manage curriculum regulations and their reference documents."
        actions={
          <Button variant="outline" asChild>
            <Link href="/academics"><ArrowLeft className="h-4 w-4 mr-1" />Back to Academics</Link>
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" />Upload Regulation Document</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          </div>

          {picker.selectedCatalogId && picker.selectedRegulation ? (
            <DocumentUploadField
              label={`${picker.selectedCatalogItem?.name ?? "Course"} — ${picker.selectedRegulation} Regulation Document`}
              value={currentUrl}
              uploadEndpoint="/api/upload/regulation-document"
              extraFields={{ catalogId: picker.selectedCatalogId, regulation: picker.selectedRegulation }}
              onUploaded={(url) => { setLocalUrl(url); void patchRegulationDocument(url); }}
              onRemoved={() => { setLocalUrl(""); void patchRegulationDocument(""); }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">Select a Regulation and Course above to upload its document.</p>
          )}
        </CardContent>
      </Card>

      <CourseCatalogSettingsCard regulationsOnly showDepartments />
    </div>
  );
}
